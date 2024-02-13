import express from 'express';
import cors from 'cors';
import {DBcall, sql} from './DBops.js';
import Fuse from 'fuse.js';
import { getDocNumber } from './server.js';
import fs from 'fs';    
import axios from 'axios';
import {exponentialBackoff} from './utils.js';
import compression from 'compression';
import { v4 as uuidv4 } from 'uuid';
import { TargetType } from 'puppeteer';
import cookieParser from "cookie-parser";
import admin from 'firebase-admin';
import fb_creds from './fb_creds.json' assert { type: 'json' };

admin.initializeApp({
    credential: admin.credential.cert(fb_creds)
});

const PORT = 8000;
const app = express();

let corsOptions = {
    origin : ['http://localhost:3000'],
    credentials:true
}
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const fuse_options = {
    keys: ['symbol', 'name', 'chunks']
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

function unauthorizedError(res, message=null){
    console.log('unauth error')
    res.statusCode = 401;
    res.json(message && message);
}

function genExpirationDate(oo){
    let expdate = new Date();
    expdate.setMonth(expdate.getMonth() + oo.month);
    return expdate;
}

async function getAPITokenByUID(uid){
    let resp = await DBcall('db_get_apitoken_by_uid', {uid});
    return resp?.rows?.[0];
}

async function verifyAPIToken(apitoken){
    let resp = await DBcall('db_verify_apitoken', {apitoken});
    console.log({resp});
    return resp?.rows?.[0];
}

async function creditAccount(uid){
    DBcall('db_credit_account', uid);
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

function authenticateToken(req, res, next) {
    const token = req?.cookies?.['AuthToken']; // Extract the token from the cookie
    if (!token) return res.sendStatus(401); // Unauthorized if there's no token

    verifyAPIToken(token).then(uid => {
        console.log('verified apitoken', uid, {token});
        if(!uid) throw new Error('Invalid apitoken');
        req.uid=uid;
        next();
    }).catch(err => {
        console.log('authenticateToken err:', err)
        res.sendStatus(403);
    });
}


const decodeFirebaseJWST = async (req, res, next) => {
    const token = req.headers.authorization?.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.log('decodeFirebaseJWST error: ', error)
        res.status(401).send('Unauthorized');
    }
};

app.get('/companies', (req, res) => {  
    const lookupRes = CIKlookup(req.query.q);
    res.json(lookupRes);
});

app.get('/conversations/:convoID', async (req, res) => {
    const db_res = await DBcall('db_getConvo', req.params);
    if(db_res?.error) return clientError(res);
    res.json(db_res);
});

app.post('/conversations', async (req, res) => {
    const db_res = await DBcall('db_insertConvo', req.body);
    if(db_res?.error || !db_res?.rowCount) return clientError(res);
    res.json({convoID:req.body.convoID});
});

app.post('/createAccount', async (req, res) => { //TODO 
    return
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

app.post('/login', decodeFirebaseJWST, async (req, res) => {
    const uid = req?.user?.uid;
    if(!uid) throw new Error('no UID');
    // ---------- DB verify user ---------- \\
    const db_res = await DBcall('db_getUser', {uid});
    if(db_res.error) return clientError(res);

    // ---------- DB verify token ---------- \\
    let apitoken_data = await getAPITokenByUID(uid);
    if(!apitoken_data){
        // ---------- DB write token ---------- \\

        const newtoken_input = {
            uid,
            apitoken: uuidv4(), 
            exptime: genExpirationDate({month:1}), 
            credits: 3 // TODO: delete
        }

        const newtoken_res = await DBcall('db_write_apitoken', newtoken_input);
        if(newtoken_res.error) return clientError(res);
        apitoken_data = await getAPITokenByUID(uid);
    }                             
    if(!apitoken_data?.apitoken) return unauthorizedError(res, 'Could not get API token. Try again');
    
    res.cookie('AuthToken', apitoken_data.apitoken, {
        // //httpOnly: true,
        // secure: false, // TODO: Set to true in production to send the cookie over HTTPS only
        // sameSite: 'None', //TODO: security check
        maxAge: 3600000,
    });

    res.json({...db_res.rows[0], ...apitoken_data});
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

app.get('/lastreport/:cik', compression(), async (req, res) => {
    function trim_xml(xmltext){
        if(req.query?.full) return xmltext;
        xmltext = xmltext 
            .replaceAll('<script', '<div hidden=true')
            .replaceAll('</script', '</div')
            .replaceAll('xmlns', '')
            .replaceAll('<img','<div hidden=true')

        const regex = /<DOCUMENT>(.*?)<\/DOCUMENT>/gs;
        const match = regex.exec(xmltext);
    
        return match ? match[1] : null;
    }
    const headers = {'User-Agent':'PostmanRuntime/7.36.0'};
    const db_res = await DBcall('db_getReport', req.params);
    if(!db_res?.rows?.[0]?.addr) return clientError(res, 'No report found');
    const link = `${global.appdata.SEC_BASEURL}${db_res.rows[0].addr}`;
    const sec_res = await exponentialBackoff(() => axios.get(link, {headers}), 6, 300);
    const trimmed_xml = trim_xml(sec_res?.data);
    res.send(trimmed_xml);
});

app.post('/messages', async (req, res) => {
    //const db_res = await DBcall('db_sendMessage', req.body);
    res.send();
});

app.post('/completionproxy', authenticateToken, async (req, res) => {
    try{
        const url = 'http://127.0.0.1:5001/completion';
        const data = {messages:req.body.messages, filingID:req.body.filingID};
        const config = {'Content-Type':'application/json', responseType:'stream'};
        const py_response = await axios.post(url, data, config);
        if(py_response.status === 200) creditAccount(req.uid);
        py_response.data.pipe(res);
    } catch (error) {
        console.error('Error proxying ai stream request:', error);
        res.status(500).send('Failed to proxy ai stream.');
    }
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