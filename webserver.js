import express from 'express';
import cors from 'cors';
import {DBcall, sql} from './DBops.js';
import Fuse from 'fuse.js';
import { getDocNumber } from './server.js';
import fs from 'fs';    
import axios from 'axios';

const PORT = 8000;
const app = express();
app.use(cors());
app.use(express.json());
const fuse_options = {
    keys: ['symbol', 'name']
};
let fuse;

async function makeFuse(companies){ // side effects! 
    fuse = new Fuse(companies, fuse_options);
}

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

    const res = fuse.search(companyName, {limit: options?.top || 5});

    const processed_res = [];
    
    for(let i=0; i<res.length; i++){
        const _tmp = res[i].item;
        _tmp.value=_tmp.name;
        _tmp.key=i;
        processed_res.push(_tmp);
    }
    return processed_res;
}

app.get('/companies', (req, res) => {  
    const lookupRes = CIKlookup(req.query.q);
    res.json(lookupRes);
});

app.get('/conversations/:convoID', async (req, res) => {
    return
    const db_res = await DBcall('db_getConvo', req.params);
    if(db_res.error) return clientError(res);
    res.json(db_res.recordsets);
});

app.post('/conversations', async (req, res) => {
    const db_res = await DBcall('db_insertConvo', req.body);
    if(db_res.error || !db_res?.rowsAffected?.[0]) return clientError(res);
    res.json({convoID:req.body.convoID});
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

    if(!cik || isNaN(Number(cik))) return clientError(res, '"q" param: invalid ticker');
    const docnr = await getDocNumber({cik,year,type}).catch(err=>console.log(err));
    
    res.json(docnr);
});

app.get('/test', async (req, res) => {
    const file = fs.readFileSync('./payx2.txt');
    console.log(file.toString());
    res.send(file);
});

app.get('/lastreport/:cik', async (req, res) => {
    const headers = {'User-Agent':'PostmanRuntime/7.36.0'};
    const db_res = await DBcall('db_getReport', req.params);
    if(!db_res?.rows?.[0]?.addr) return clientError(res, 'No report found');
    const link = `${global.appdata.SEC_BASEURL}${db_res.rows[0].addr}`
    const sec_res = await axios.get(link, {headers}).catch(err => console.log(err));
    res.send(sec_res?.data);
});

app.post('/messages', async (req, res) => {
    const db_res = await DBcall('db_sendMessage', req.body);
    res.send();
});

async function startServer(){
    //const companies = (await db_getAllCompanies().catch(err=>console.log(err))).recordsets[0];
    const companies = await DBcall('db_getAllCompanies');
    await makeFuse(companies.rows);

    app.listen(PORT, () => {
        console.log('Listening on ' + PORT);
    })
}

export {startServer};