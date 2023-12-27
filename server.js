import axios from 'axios';
import company_tickers from './company_tickers.json' assert { type: 'json' };;
import Fuse from 'fuse.js';
import { TextAnalysisClient, AzureKeyCredential } from '@azure/ai-language-text';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();
const key = process.env.COGNITIVEAPIKEY;
const endpoint = 'https://researchr.cognitiveservices.azure.com/';
let input_org;

//////////////////////// ======= DEV MODE ======== \\\\\\\\\\\\\\\\\\\\\\\\
let isDevelopment = true;
if(!['production','development'].includes(process.env.NODE_ENV)){
    console.warn('\nYou did not specify the environment. (NODE_ENV=developoment node server)');
    isDevelopment = true;
}
if(process.env.NODE_ENV === 'production') isDevelopment = false;
console.log(`\n----- Running as ${process.env.NODE_ENV?.toUpperCase() ?? 'DEVELOPMENT'} -----\n`);

//////////////////////// ======= UTILS ======== \\\\\\\\\\\\\\\\\\\\\\\\
function padNumberWithZeros(number, length) {
    return String(number).padStart(length, '0');
}

//////////////////////// ======= PROGRAM ======== \\\\\\\\\\\\\\\\\\\\\\\\

const documents = [ "Give me the operating income of paychex in the last report" ];

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

async function getFilings(cik){
  const BASE_URL = 'https://www.sec.gov/Archives/edgar';
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({   
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
    'content-type': 'text/plain;charset=UTF-8',
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
  })
  await page.goto(`${BASE_URL}/data/${cik}`, { waitUntil: "domcontentloaded" }, { timeout: 0 });
  

  let acceptionNo = await page.evaluate(() => {
    function getAccessions(document){
      return Array.from(document.querySelectorAll('td > a')).map(x => x.innerText).slice(0,1000);
    }
    const accessions = getAccessions(document);
    const reports = accessions.filter(e => e[3] === '0'); // filter accessions for reports only
    return reports[0];
  });
  
  
  // accesion no. formatting
  const n_long =  acceptionNo.slice(-6);
  const n_short =  acceptionNo.slice(-8, -6);
  const acceptionAddress = `${BASE_URL}/data/${cik}/${acceptionNo}/${acceptionNo.slice(0,10)}-${n_short}-${n_long}-index.html`;

  await page.goto(acceptionAddress, { waitUntil: "domcontentloaded" }, { timeout: 0 });
  // get accession filename
  let report_filename = await page.evaluate(()=>{
    // filter only 10-Q's from the list of filed files
    const reportRow = Array.from(document.querySelectorAll('.tableFile[summary="Document Format Files"] > tbody > tr')).filter(tr => tr.children[1].textContent === '10-Q')[0];
    return reportRow.children[2].innerText;
  });
  report_filename = report_filename.split('.')[0]+'.htm'; //clean iXBRL after
  const reportURL = `${BASE_URL}/data/${cik}/${acceptionNo}/${report_filename}`;

  await page.goto(reportURL, { waitUntil: "domcontentloaded" }, { timeout: 0 });
  let report = await page.evaluate(()=>{return document.querySelector('body').innerHTML});

  console.log(report);
  browser.close();

  const res = ask('what does paychex do?', report)
  console.log(res)
}

async function ask(question, data){
  const requestData = {
    question,
    records: [
      {id:1, text:data}
    ],
    language: 'en',
    stringIndexType: 'Utf16CodeUnit'
  };

  const headers = {
    'Ocp-Apim-Subscription-Key': key,
    'Content-Type': 'application/json'
  };
  const url = `${endpoint}language/:query-text?api-version=2023-04-01`;
  const res = await axios.post(url, requestData, {headers}).catch(err => console.log(err));
  return {anwser: res.data.answers[0].answer, anwserSpan: res.data.answers[0].answerSpan.text};
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

// main().catch((err) => {
//     console.error("The sample encountered an error:", err);
// });

//main();
getFilings(723531);
//ask('whos the reporter?' , 'They have announced that the weather today will be very sunny with lots of sunny sun in the bright sky. The report is andrew fk.');
