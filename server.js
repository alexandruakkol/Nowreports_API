import axios from 'axios';
import company_tickers from './company_tickers.json' assert { type: 'json' };
import Fuse from 'fuse.js';
import { TextAnalysisClient, AzureKeyCredential } from '@azure/ai-language-text';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();
const key = process.env.COGNITIVEAPIKEY;
const endpoint = 'https://researchr.cognitiveservices.azure.com/';
const BASE_URL = 'https://www.sec.gov/Archives/edgar';
const BASE_DATA_URL = BASE_URL+ '/data/';
let input_org;
let sql;
const PUP_BROWSER_CONFIG = {headless: 'new'};
//////////////////////// ======= DEV MODE ======== \\\\\\\\\\\\\\\\\\\\\\\\
let isDevelopment = true;
if(!['production','development'].includes(process.env.NODE_ENV)){
    console.warn('\nYou did not specify the environment. (NODE_ENV=developoment node server)');
    isDevelopment = true;
}
if(process.env.NODE_ENV === 'production') isDevelopment = false;
if(!isDevelopment) PUP_BROWSER_CONFIG.executablePath = '/bin/chromium';

console.log(`\n----- Running as ${process.env.NODE_ENV?.toUpperCase() ?? 'DEVELOPMENT'} -----\n`);

//////////////////////// ======= UTILS ======== \\\\\\\\\\\\\\\\\\\\\\\\
function padNumberWithZeros(number, length) {
  return String(number).padStart(length, '0');
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
//////////////////////// ======= PROGRAM ======== \\\\\\\\\\\\\\\\\\\\\\\\

const documents = [ "Give me the operating income of paychex in the last report" ];

async function sendDatapointsToDB(url, cik){
  const {reportURL, year, date, type} = url;
  console.log('sendDatapointsToDB ',url)
  if(!reportURL) return console.error('sendDatapointsToDB : No reportURL');
  const request = new sql.Request();
  request.input('cik', sql.NVarChar(100), cik);
  request.input('addr', sql.NVarChar(200), reportURL.replace('https://www.sec.gov/Archives/edgar/data/',''));
  request.input('year', sql.SmallInt, year);
  request.input('repDate', sql.Date, date);
  request.input('typ', sql.NVarChar(20), type);
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

async function check_get_report(reportData, page){ // gets a particular report (filename) by year/type/company (ex. 2023 Annual AAPL)
  // in: accession number | out: foundObj  if 10-K is found
  let {cik, accesionNo, year, type} = reportData;
  if(!accesionNo) return console.error('check_get_report : no accessionNo');
  // accesion no. formatting
  const n_long =  accesionNo.slice(-6);
  const n_short =  accesionNo.slice(-8, -6);
  const acceptionAddress = `${BASE_URL}/data/${cik}/${accesionNo}/${accesionNo.slice(0,10)}-${n_short}-${n_long}-index.html`;
  await page.goto(acceptionAddress, { waitUntil: "domcontentloaded" }, { timeout: 0 });

  // get accession filename
  let report_filename = await page.evaluate((type)=>{
    // filter by report year
    const reportDate = document.querySelector("#formDiv > div.formContent > div:nth-child(2) > div.info")?.innerText;
    const reportYear = reportDate?.substring(0, 4);
    // filter by report type
    //console.log(document.querySelectorAll('.tableFile[summary="Document Format Files"] > tbody > tr')).filter(tr => tr.children[1].textContent.startsWith('10'))
    const reportList = Array.from(document.querySelectorAll('.tableFile[summary="Document Format Files"] > tbody > tr'));
    const reportRow = reportList.filter(tr => tr.children[1].textContent.startsWith('10-K'))[0];

    return JSON.stringify({year:reportYear, doc:reportRow?.children[2]?.innerText, type:reportRow?.children[1]?.textContent, date:reportDate});
  });
  report_filename = JSON.parse(report_filename);
  //console.log(accesionNo, {report_filename})
  if(!report_filename.doc) return {error:'No 10-K'};

  report_filename.doc = report_filename.doc.split('.')[0]+'.htm'; //clean URL
  const reportURL = `${BASE_URL}/data/${cik}/${accesionNo}/${report_filename.doc}`;

  return {reportURL, year:report_filename.year, type:report_filename.type, date:report_filename.date};
  
  await page.goto(reportURL, { waitUntil: "domcontentloaded" }, { timeout: 0 });
  let report = await page.evaluate(()=>{return document.querySelector('body').innerHTML});

  //this actually gets the report
  // // get accession filename
  // let report_filename = await page.evaluate(()=>{
  //   // filter only 10-Q's from the list of filed files
  //   const reportRow = Array.from(document.querySelectorAll('.tableFile[summary="Document Format Files"] > tbody > tr')).filter(tr => tr.children[1].textContent === '10-Q')[0];
  //   return reportRow.children[2].innerText;
  // });
  // report_filename = report_filename.split('.')[0]+'.htm'; //clean iXBRL after
  // const reportURL = `${BASE_URL}/data/${cik}/${accesionNo}/${report_filename}`;
  
  // await page.goto(reportURL, { waitUntil: "domcontentloaded" }, { timeout: 0 });
  // let report = await page.evaluate(()=>{return document.querySelector('body').innerHTML});
  // console.log(report)
}

async function getLastAnnualFromDB(cik){
  const request = new sql.Request();
  request.input('cik', sql.NVarChar(20), cik);
  let res = await request.execute('dbo.getAnnualReport').catch(err=>console.log(err));
  res = res?.recordset?.[0]?.addr;
  if(res) return BASE_DATA_URL+res;
}

async function getDocNumber(oo){
  if(!sql) sql = global.sqlconn;
  let {cik, year, type} = oo;  
  if(!type) type='annual';
  if(!['annual', 'quarterly'].includes(type)) return console.error('getDocNumber no type');
  if(!year) year = (new Date()).getFullYear();

  if(type == 'annual') type = '10-K';
  if(type == 'quarterly') type = '10-Q';

  if(type === '10-K') {
    const DBcheck = await getLastAnnualFromDB(cik);
    if(DBcheck) return DBcheck;
  }

  const browser = await puppeteer.launch({headless: 'new', executablePath: '/bin/chromium'});
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({   
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
    'content-type': 'text/plain;charset=UTF-8',
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
  })
  await page.goto(`${BASE_URL}/data/${cik}`, { waitUntil: "domcontentloaded" }, { timeout: 0 });
  
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

  //first, check if the list of 0 codes has any 10-ks
  let foundObj = await checkCandidateReports(reports);
  console.log({foundObj}); 

  if(foundObj) {
    cleanup(foundObj, browser, cik);
    return foundObj;
  }

  // ---------------- ATTEMPT 2 ---------------- \\ if not, check each report one by one
  for(let i=0; i<allAccessions.length; i++){
    if(i%9 === 0) await sleep(1000); //rate limiting for SEC;
    let accession = allAccessions[i];
    await page.goto(`${BASE_URL}/data/${cik}/${accession}`, { waitUntil: "domcontentloaded" }, { timeout: 0 });
    let string_res_2 =  await page.evaluate(() => {
      function getDocs(document){
        return Array.from(document.querySelectorAll('td > a')).map(x => x.innerText).slice(0,50);
      }
      const docs = getDocs(document);
      return docs;
    });

    if(string_res_2.length > 8){
      const check_get = await check_get_report({cik, accesionNo:accession}, page);
      if(check_get?.reportURL) {
        foundObj = check_get;
        console.log({foundObj});
        break;
      }
    }
  }

  if(foundObj) {
    cleanup(foundObj, browser, cik);
    return foundObj;
  }

  // ---------------- LOOKUP UTILS ---------------- \\
  async function cleanup(foundObj, browser, cik){
    browser.close();
    sendDatapointsToDB(foundObj, cik);
  }

  async function checkCandidateReports(list){
    //TODO: remove slice
    for(let i=0; i<100; i++){
      if(i%9 === 0) await sleep(1000); //rate limiting for SEC;
      const foundReport = await check_get_report({cik, accesionNo:list[i], year, type}, page);
      if(!foundReport) continue;
      if((Number(foundReport.year) <= Number(year)) && (foundReport.type == type)) {return foundReport;}
    }
  }

}

async function ask(question){
  const requestData = {
    question,
    // records: [
    //   {id:1}
    // ],
    // language: 'en',
    // stringIndexType: 'Utf16CodeUnit',
    
  };

  const headers = {
    'Ocp-Apim-Subscription-Key': key,
    'Content-Type': 'application/json'
  };
  const url = `${endpoint}language/:query-knowledgebases?api-version=2021-10-01&projectName=nowReports&deploymentName=test`;
  const res = await axios.post(url, requestData, {headers}).catch(err => console.log(err));
  return res.data;
}

// example of how to use the client library to recognize entities in a document.
async function main() {
    console.log("== NER sample ==");
  
    const client = new TextAnalysisClient(endpoint, new AzureKeyCredential(key));
  
    const results = await client.analyze("EntityRecognition", documents);
  
    for (const result of results) {
      console.log(`- Document ${result.id}`);
      if (!result.error) {
        console.log("\tRecognized Entities:");
        for (const entity of result.entities) {
            if(entity.category === 'Organization') input_org = entity.text;
          console.log(`\t- Entity ${entity.text} of type ${entity.category}`);
        }
      } else console.error("\tError:", result.error);
    }

    const {cik_str} = CIKlookup(input_org);
    if(!cik_str) throw new Error(`No CIK for input '${input_org}'`);

    console.log(cik_str);
  }

  async function anwserQuestion(question){

  }
// main().catch((err) => {
//     console.error("The sample encountered an error:", err);
// });
async function start(){
  //sql = await DBConn();
  const doc = await getDocNumber({cik:723531, year:2022, type:'annual'});
  console.log({doc});
}
//ask('what is the filing date of the PAYX 10-Q?');
//main();
//ask('whos the reporter?' , 'They have announced that the weather today will be very sunny with lots of sunny sun in the bright sky. The report is andrew fk.');
export {getDocNumber};