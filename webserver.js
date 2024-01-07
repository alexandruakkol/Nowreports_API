import express from 'express';
import cors from 'cors';
import company_tickers from './company_tickers.json' assert { type: 'json' };
import Fuse from 'fuse.js';
import { getDocNumber } from './server.js';
import fs from 'fs';    
import axios from 'axios';

const PORT = 8000;
const app = express();
let sql;
app.use(cors());
app.use(express.json());
const fuse_options = {
    keys: ['ticker', 'title']
};
const fuse = new Fuse(Object.values(company_tickers), fuse_options);

function padNumberWithZeros(number, length) {
    return String(number).padStart(length, '0');
}

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';
  
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      randomString += characters.charAt(randomIndex);
    }
  
    return randomString;
}

function clientError(res, message=null){
    res.statusCode = 400;
    res.json(message && message);
}

function CIKlookup(companyName, options){
    console.log(`== CIK lookup for ${companyName} ==`);

    const res = fuse.search(companyName, {limit: options?.top || 7});

    // // CIK needs to have 10 digits with leading 0s
    // res.cik_str = padNumberWithZeros(item.cik_str, 10);
    const processed_res = [];
    
    for(let i=0; i<res.length; i++){
        const _tmp = res[i].item;
        _tmp.value=_tmp.title;
        _tmp.key=i;

        processed_res.push(_tmp);
    }
    return processed_res;
}

app.get('/companies', (req, res) => {  
    const lookupRes = CIKlookup(req.query.q);
    res.json(lookupRes);
});

app.post('/createAccount', async (req, res) => {
    function incompleteRequest(){
        res.statusCode = 400;
        res.json({error:'incomplete request'});
    }
    const {uid, fname, lname, email } = req.body;
    if(!(uid && fname && lname && email)) return incompleteRequest();

    const request = new sql.Request();
    request.input('uid', sql.NVarChar(100), uid);
    request.input('fname', sql.NVarChar(100), fname);
    request.input('lname', sql.NVarChar(100), lname);
    request.input('email', sql.NVarChar(200), email);
    try{
        await request.execute('dbo.createAccount');
    } catch(err){
        console.log(err);
        res.statusCode = 500;
    }
    res.json();
});

app.get('/users/:uid', async (req, res) => {
    const {uid} = req.params;
    const request = new sql.Request();
    request.input('uid', sql.NVarChar(100), uid);
    try{
        const data = await request.execute('dbo.getUserDetails');
        res.json(data);
    } catch(err){
        console.log(err);
        res.statusCode=500;
        res.json();
    }
});

app.get('/links', async (req, res) => {
    let {q, year, type} = req.query;
    let cik;
    if( !(q)) return clientError(res, '"q" param is required: either symbol or CIK number');

    if( isNaN(Number(q)) ) cik = String(CIKlookup(q, {top:1})?.[0]?.cik_str); // if symbol, get CIK
    else cik = q;

    console.log({cik})
    if(!cik || isNaN(Number(cik))) return clientError(res, '"q" param: invalid ticker');
    const docnr = await getDocNumber({cik,year,type}).catch(err=>console.log(err));
    res.json(docnr);
});

app.get('/test', async (req, res) => {
    const file = fs.readFileSync('./payx2.txt');
    console.log(file.toString())
    res.send(file);
});

app.post('/reports', async (req, res) => {
    const {link} = req.body;
    console.log('getting report for '+link);
    const headers = {'User-Agent':'PostmanRuntime/7.36.0'};
    const sec_res = await axios.get(link, {headers}).catch(err => console.log(err));
    console.log(sec_res)
    res.send(sec_res?.data);
});

async function startServer(){
    sql = global.sqlconn;

    app.listen(PORT, () => {
        console.log('Listening on ' + PORT);
    })
}

export {startServer};