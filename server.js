import company_tickers from './data/company_tickers.json' assert { type: 'json' };
import Fuse from 'fuse.js';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';
import {sql, DBcall} from './DBops.js';
import { getTranscripts } from './transcripts.js';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();
const PUP_BROWSER_CONFIG = {headless: 'new'}; // 'new' || false
let BASE_DATA_URL;
//////////////////////// ======= DEV MODE ======== \\\\\\\\\\\\\\\\\\\\\\\\

const distro = getEnvironment();

let isDevelopment = true;
if(!['production','development'].includes(process.env.NODE_ENV)){
    console.warn('\nYou did not specify the environment. (NODE_ENV=development node server)');
    isDevelopment = true;
}
if(process.env.NODE_ENV === 'production') isDevelopment = false;

if(!isDevelopment){
  switch(distro){
    case 'Ubuntu': PUP_BROWSER_CONFIG.executablePath = '/snap/bin/chromium'; break;
    case 'Kali': PUP_BROWSER_CONFIG.executablePath = '/bin/chromium'; break;
  }
} 

console.log(`\n----- Running as ${process.env.NODE_ENV?.toUpperCase() ?? 'DEVELOPMENT'} -----\n`);

//////////////////////// ======= UTILS ======== \\\\\\\\\\\\\\\\\\\\\\\\
function padNumberWithZeros(number, length) {
  return String(number).padStart(length, '0');
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function getEnvironment(){
  let distro;
  try{
    const file = fs.readFileSync('/etc/os-release', 'utf8');
    if (!file) return distro = 'macOS';
    const lines = file.split('\n');
    lines.forEach(line => {

      if (line.startsWith('PRETTY_NAME')) distro = line.split('=')[1].replace(/"/g, '');
    });
    if(!distro) distro = 'macOS';

  } catch{distro='macOS'}

  if(distro.includes('Ubuntu')) distro = 'Ubuntu';
  if(distro.includes('Kali')) distro = 'Kali';

  return distro;
}

//////////////////////// ======= PROGRAM ======== \\\\\\\\\\\\\\\\\\\\\\\\

async function sendErrorCIKToDB(oo){
  const {cik, typ} = oo;
  if(!cik?.length) return console.error('sendErrorCIKToDB : No CIK');
  console.log(' ----- Could not get '+ cik );
  const request = new sql.Request();
  request.input('cik', sql.NVarChar(100), cik);
  request.input('typ', sql.NVarChar(20), typ);
  await request.execute('dbo.updateFilings').catch(err=>console.log(err));
}

function CIKlookup(companyName){
  console.log(`== CIK lookup for ${companyName} ==`);
  
  const options = {
    keys: ['title']
  };

  const fuse = new Fuse(Object.values(company_tickers), options);
  const {item} = fuse.search(companyName, {limit:1})[0];

  isDevelopment ?? console.log(`Found CIK for ${item.title}`);

  // CIK needs to have 10 digits with leading 0s
  item.cik_str = padNumberWithZeros(item.cik_str, 10);

  return item;
}

// gets a particular report (filename) by year/type/company (ex. 2023 Annual AAPL)
async function check_get_report(reportData, page){ 
  // in: accession number | out: foundObj  if 10-K is found
  let {cik, accesionNo, year, type} = reportData;
  if(!accesionNo) return console.error('check_get_report : no accessionNo');
  // accesion no. formatting
  const n_long =  accesionNo.slice(-6);
  const n_short =  accesionNo.slice(-8, -6);
  const acceptionAddress = `${BASE_DATA_URL}${cik}/${accesionNo}/${accesionNo.slice(0,10)}-${n_short}-${n_long}-index.html`;
  await page.goto(acceptionAddress, { waitUntil: "domcontentloaded" }, { timeout: 0 });

  // get accession filename
  let report_filename = await page.evaluate((type)=>{
    // filter by report year
    const reportDate = document.querySelector("#formDiv > div.formContent > div:nth-child(2) > div.info")?.innerText;
    const reportYear = reportDate?.substring(0, 4);
    // filter by report type
    const reportList = Array.from(document.querySelectorAll('.tableFile[summary="Document Format Files"] > tbody > tr'));
    const typeRow = reportList.filter(tr => tr.children[1].textContent.includes('10-K'))[0];

    let reportRow;
    if(typeRow) reportRow = reportList.filter(tr => tr.children[1].textContent.includes('text file'))[0];

    return JSON.stringify({year:reportYear, doc:reportRow?.children[2]?.innerText, type:typeRow?.children[1]?.textContent, date:reportDate});
  });
  report_filename = JSON.parse(report_filename);
  if(!report_filename.doc) return {error:'No 10-K'};

  report_filename.doc = report_filename.doc.split('.')[0]+'.txt'; //clean URL
  const reportURL = `${BASE_DATA_URL}${cik}/${accesionNo}/${report_filename.doc}`;

  return {reportURL, year:report_filename.year, typ:report_filename.type, date:report_filename.date};
}

async function getLastAnnualFromDB(cik){
  const res = await DBcall('db_getReport', {cik});
  let res_addr = res?.rows?.[0]?.addr;
  if(res_addr) return BASE_DATA_URL + res_addr;
}

async function getDocNumber(oo){  // MODULE START
  if(global?.appdata) BASE_DATA_URL = global?.appdata.SEC_BASEURL;
  let {cik, year, type, mode, symbol} = oo;  

  if(!type) type='annual';
  if(!['annual', 'quarterly'].includes(type)) return console.error('getDocNumber no type');
  if(!year) year = (new Date()).getFullYear();

  if(type == 'annual') type = '10-K';
  if(type == 'quarterly') type = '10-Q';

  if((type === '10-K') && (mode !== 'update')) {
    const DBcheck = await getLastAnnualFromDB(cik);
    if(DBcheck) {
      console.log(`-- ${cik} already in DB. Skipping ...`)
      return DBcheck;
    }
  }

  const browser = await puppeteer.launch(PUP_BROWSER_CONFIG);
  const context = await browser.createIncognitoBrowserContext(); 


  try{
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({   
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
      'content-type': 'text/plain;charset=UTF-8',
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
    });

    await page.goto(`${BASE_DATA_URL}${cik}`, { waitUntil: "domcontentloaded" }, { timeout: 0 });
    
    // ---------------- START LOOKING FOR LAST 10K ---------------- \\
  
    // ---------------- ATTEMPT 1 ---------------- \\ look at the ones with 0
    let string_res_1 = await page.evaluate(() => {
      function getAccessions(document){
        return Array.from(document.querySelectorAll('td > a')).map(x => x.innerText).slice(0,300);
      }
      const allAccessions = getAccessions(document);
      const reports = allAccessions.filter(e => e[3] === '0'); // filter accessions for reports only
      return JSON.stringify({reports, allAccessions});
    });
    let {reports, allAccessions} = JSON.parse(string_res_1);
    // here I have a list of top X filings, in reportsList, as directory IDs.
  
    // //first, check if the list of 0 codes has any 10-ks
    //let foundObj = await checkCandidateReports(reports);
    let foundObj;
    // if(foundObj) {
    //   cleanup(foundObj, browser, cik);
    //   return foundObj;
    // }
  
    // ---------------- ATTEMPT 2 ---------------- \\ if not, check each report one by one
    for(let i=0; i<allAccessions.length; i++){
      if(i%9 === 0) await sleep(1000); //rate limiting for SEC;
      let accession = allAccessions[i];
      await page.goto(`${BASE_DATA_URL}${cik}/${accession}`, { waitUntil: "domcontentloaded" }, { timeout: 0 });
      let string_res_2 =  await page.evaluate(() => {
        function getDocs(document){
          return Array.from(document.querySelectorAll('td > a')).map(x => x.innerText).slice(0,150);
        }
        const docs = getDocs(document);

        return docs;
      });

      if(string_res_2.length > 8){
        const check_get = await check_get_report({cik, accesionNo:accession}, page);
        if(check_get?.reportURL) {
          foundObj = check_get;
          break;
        }
      }
    }
    
    if(foundObj) {
      const transcripts = await getTranscripts(page, symbol);
      cleanup(foundObj, transcripts, browser, cik);
      return foundObj;
    }
  
    // ---------------- LOOKUP UTILS ---------------- \\
    async function cleanup(foundObj, transcripts, browser, cik){
      browser.close();
      DBcall('db_insertFiling', {...foundObj, cik} );
      // DB insert transcripts
      if(transcripts.callPeriod && transcripts.convo.length){
        try{
          const callid = symbol + transcripts.callPeriod.replace(' ','');
          await DBcall('db_insert_transcript', {callid, callPeriod:transcripts.callPeriod, symbol} );
          for(const message of transcripts.convo) DBcall('db_insert_transcript_message', {...message, callid});
        } catch {
          console.log(err);
        }

      }
    }
  
    async function checkCandidateReports(list){
      //TODO: remove slice
      for(let i=0; i<list.length; i++){
        if(i%9 === 0) await sleep(1000); //rate limiting for SEC;
        const foundReport = await check_get_report({cik, accesionNo:list[i], year, type}, page);
        if(!foundReport) continue;
        if((Number(foundReport.year) <= Number(year)) && (foundReport.type == type)) {return foundReport;}
      }
    }
  }
  
  catch(err){
    await browser.close(); // so that browser never hangs
    throw new Error(err);
  }
}

export {getDocNumber, sendErrorCIKToDB};