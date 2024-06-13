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
import cookieParser from "cookie-parser";
import admin from 'firebase-admin';
import fb_creds from './fb_creds.json' assert { type: 'json' };
import stripeConfig from './stripe.js';
import dotenv from 'dotenv';

//TODO: modularize these sections (in Classes maybe)
/////////////////// -------- CONFIG -------- \\\\\\\\\\\\\\\\\\\\\\\\\\

dotenv.config();
admin.initializeApp({
    credential: admin.credential.cert(fb_creds)
});

const DOMAIN = 'https://ceochat.nowreports.com'
const AI_API_ADDR = 'http://127.0.0.1:8006/completion';
const PORT = 8005;
const app = express();
const apiRouter = express.Router();

app.use(express.static('./served_assets'));
app.use(compression());

let corsOptions = {
    origin : ['http://localhost:3000', DOMAIN, 'https://www.nowreports.com'],
    credentials:true
}

if(process.env.ENV === 'production') app.use('/api', apiRouter);
app.use('*', cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

/////////////////// -------- FUSE INIT -------- \\\\\\\\\\\\\\\\\\\\\\\\\\
let fuse;

const fuse_options = {
    keys: ['symbol', 'name', 'chunks']
};

async function makeFuse(companies){ // side effects!
    fuse = new Fuse(companies, fuse_options);
}

/////////////////// -------- UTILS -------- \\\\\\\\\\\\\\\\\\\\\\\\\\

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

function genExpirationDate(oo){
    let expdate = new Date();
    expdate.setMonth(expdate.getMonth() + oo.month);
    return expdate;
}
/////////////////// -------- API UTILS -------- \\\\\\\\\\\\\\\\\\\\\\\\\\

function clientError(res, message=null){
    res.statusCode = 400;
    res.json(message && message);
}

function serverError(res, message=null){
    res.statusCode = 500;
    res.json(message && message);
}

function unauthorizedError(res, message=null){
    console.log('unauth error')
    res.statusCode = 401;
    res.json(message && message);
}

async function getAPITokenByUID(uid){
    let resp = await DBcall('db_get_apitoken_by_uid', {uid});
    return resp?.rows?.[0];
}

async function verifyAPIToken(apitoken){
    let resp = await DBcall('db_verify_apitoken', {apitoken});
    return resp?.rows?.[0];
}

async function creditAccount(uid, amount=1){
    DBcall('db_credit_account', {uid, amount});
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
    //console.log('cook',req?.cookies?.['AuthToken'] );
    if (!token) return res.sendStatus(401); // Unauthorized if there's no token

    verifyAPIToken(token).then(obj => {
        if(!obj?.uid) throw new Error('Invalid apitoken');
        req.uid=obj.uid;
        req.credits=obj.credits || 0;
        next();
    }).catch(err => {
        console.log('authenticateToken err:', err);
        res.sendStatus(403);
    });
}

const mid_decodeFirebaseJWST = async (req, res, next) => {
    const token = req.headers.authorization?.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.log('decodeFirebaseJWST error: ', error);
        res.status(401).send('Unauthorized');
    }
};

/////////////////// -------- API PATHS -------- \\\\\\\\\\\\\\\\\\\\\\\\\

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
    const {idtoken, name, email, stripe_customer_id} = req?.body;
    if(!(idtoken && email && name, stripe_customer_id)) return clientError(res, 'incomplete request');
    const verified_token = await admin.auth().verifyIdToken(idtoken);
    const uid = verified_token.uid;
    if(!uid) return unauthorizedError(res);
    const db_res = await DBcall('db_create_account', {name, email, uid, stripe_customer_id});
    if(db_res?.rowCount == 1) res.json();
    else return serverError(res, 'Could not create account. Code 11');
});

app.post('/login', mid_decodeFirebaseJWST, async (req, res) => {
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
        }

        const newtoken_res = await DBcall('db_write_apitoken', newtoken_input);
        if(newtoken_res.error) return clientError(res);
        apitoken_data = await getAPITokenByUID(uid);
    }         
    if(!apitoken_data?.apitoken) return unauthorizedError(res, 'Could not get API token. Try again');

    res.cookie('AuthToken', apitoken_data.apitoken, {
        path: process.env.ENV === 'production' ? '/api' : '/', 
        secure: process.env.ENV === 'production' ? true : false, 
        httpOnly:true,
        //sameSite: 'None', //TODO: security check
        maxAge: 3600000 * 336, //2 wks of expiry
    });

    res.json({...db_res.rows[0], ...apitoken_data});
});

app.get('/products', async(req, res) => {
    try{
        const products = await DBcall('db_get_product_types');
        res.json(products);
    }
    catch(err){
        console.log(err);
        res.status(500).send();
    }
})

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

app.get('/tests/api', (req, res) => {
    res.send();
});

app.get('/tests/ai', async (req, res) => {
    try{
        const ai_res = await axios.get(AI_API_ADDR.replace('/completion', '/test'));
        res.send();
    }catch(err){
        console.error('AI testing endpoint fail', err);
        res.status(500).send();
    }
});

app.get('/lastreport/:cik', async (req, res) => {
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
    const headers = {'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.3'};
    const db_res = await DBcall('db_getReport', req.params);
    if(!db_res?.rows?.[0]?.addr) return clientError(res, 'No report found');
    const link = `${global.appdata.SEC_BASEURL}${db_res.rows[0].addr}`;
    const sec_res = await exponentialBackoff(() => axios.get(link, {headers}), 6, 300);
    const trimmed_xml = trim_xml(sec_res?.data);
    res.send(trimmed_xml);
});

app.post('/messages', async (req, res) => {
    try{
        const db_res = await DBcall('db_sendMessage', req.body);
        res.status(200).send();
    } catch(err){
        console.error('Message send error', err);
        res.send(500).send();
    }
});

app.post('/completionproxy', authenticateToken, async (req, res) => {
    try{
        if(req.credits < 1) return res.status(403).send('Monthly query limit exceeded'); 
        const data = {messages:req.body.messages, filingID:req.body.filingID};
        const config = {'Content-Type':'application/json', responseType:'stream'};
        const py_response = await axios.post(AI_API_ADDR, data, config);
        if(py_response.status === 200) creditAccount(req.uid);
        py_response.data.pipe(res);
    } catch (error) {
        console.error('Error proxying ai stream request:', error);
        res.status(500).send('Failed proxy AI stream.');
    }
});

app.post('/logs', async (req, res) => {
    try{
        await DBcall('db_insert_log', req.body);
    } catch(error){
        console.error('Log write error ', req.body)
        res.status(500).send();
    }
    res.send();
});

app.post('/feedback', async (req, res) => {
    try{
        await DBcall('db_insert_feedback', req.body);
    }catch(err){
        console.error('Feedback send error ', req.body)
        res.status(500).send();
    }
    res.send();
})

app.get('/features', async (req, res) => {
    try{
        const db_res = await DBcall('db_get_newfeatures', req.body);
        res.send(db_res?.rows);
    }catch(err){
        console.error('Features get error ', req.body)
        res.status(500).send();
    }
});

app.get('/report', authenticateToken, async (req, res) => {

    async function try_get_report(){
        const cached_reports_res = await DBcall('db_get_report', req.query);
        const cached_reports = cached_reports_res?.rows;
        // send response if reports in DB
        if(cached_reports.length){ 
            res.send(cached_reports); 
            //subtract two credits
            if(cached_reports.length) creditAccount(req.uid, 2);
            return true; 
        }
        return false;
    }

    function LLM(question, req){
        if(req.credits < 1) return res.status(403).send('Monthly query limit exceeded'); 
        const question_json = [{"role": "user", "content":question}]
        const data = {messages: JSON.stringify(question_json), filingID:req.query.filingID, isAIReport:true};
        const config = {'Content-Type':'application/json'};
        return axios.post(AI_API_ADDR, data, config);
    }

    try{
        if(!req.query.filingID) return clientError(res, 'filingID required');

        //check DB cache
        const has_sent_report = await try_get_report();
        if(has_sent_report) return; 
        
        //if reports not in DB, generate
        const questions_arr = (await DBcall('db_get_report_questions', req.query))?.rows;
        const promises=[];

        //filter out secondary questions (some data is pulled in 2 steps)
        const questions_arr_primary = questions_arr.filter(q => !q.prev);

        for(const question_obj of questions_arr_primary){
            const {display, question, id} = question_obj;
            if(req.credits < 1) return res.status(403).send('Monthly query limit exceeded'); 
            const promise = LLM(question, req);
            promises.push(promise);
        }

        const questions_arr_secondary = questions_arr.filter(q => q.prev);
        const has_secondary_idlist = questions_arr.map(q => q.prev);

        Promise.all(promises).then(async responses => {
            
            for(let i=0; i < responses.length; i++){
                
                const response = responses[i];
                let questionid = questions_arr[i].id;
                
                // if response has a next step, get it. now it's all in sequence (if you have more than one double question, is inefficient)
                //todo for more double questions is another Promise.all queue for batching 2nd instead of interating and awaiting
                if(has_secondary_idlist.includes(questionid) && !response.data.includes("insignificant")){
                    const second_question_obj = questions_arr_secondary.find(q => q.prev === questionid);
                    const second_response = await LLM(second_question_obj.question, req);
                    response.data = second_response.data;
                    questionid = second_question_obj.id;
                }
                
                const py_response = response.data.replaceAll('[ss]','');
                //write to cache
                await DBcall('db_insert_report_piece', { questionid:questionid, filingid:req.query.filingID, reply:py_response });
            }

            // try read from cache 2nd time
            const has_sent_report = await try_get_report();
            if(has_sent_report) return; 
            else return serverError(res, 'Report generation error.');
        }
        );
        // const res_data = py_response.data.replaceAll('[ss]','');
        // const db_res = await DBcall('db_insert_report_piece', { questionid:id, filingid:req.query.filingID, reply:res_data });

        //res.send(db_res?.rows);
    }catch(err){
        console.error('Report get error ', req.query, err)
        res.status(500).send();
    }
});

//TODO: move this on top of file
stripeConfig().then(async stripe => {

    const key = process.env.ENV === 'production' ? 'stripe_priceid' : 'stripe_test_priceid';
    const priceid_key = (await DBcall('db_get_diverse_webserver', {key})).rows[0].value;

    app.post('/create-checkout-session', async (req, res) => {
        try{
            const checkoutObj = {
                customer:req.body.customer,
                line_items: [
                  {
                    price: priceid_key,
                    quantity: 1,
                  },
                ],
                mode: 'subscription',
                //allow_promotion_codes: true,
                success_url: `${DOMAIN}/subscription?success=true`,
                cancel_url: `${DOMAIN}/subscription?canceled=true`,
            };
            if(req.body?.email?.endsWith('nowreports.com')) checkoutObj.discounts = [{"coupon": "axY4PqGK"}];
            const session = await stripe.checkout.sessions.create(checkoutObj);
            res.json({url: session.url});

        }catch(err){
            console.log(err);
            res.status(500).send();
        }
    });

    app.post('/create-stripe-customer', async(req, res) => {
        try{
            const {name, email} = req.body;
            const customer = await stripe.customers.create({name, email});
            res.json(customer);
        }catch(err){
            res.status(500).send();
        }
    });

    app.post('/cancel-subscription', async (req, res) => {
        try{
            const {subID} = req.body;
            const sub_cancel = await stripe.subscriptions.update(
                subID,
                {
                  cancel_at_period_end: true,
                }
            );
            res.send();
        }catch(err){
            res.status(500).send();
        }
    })
});

//=================================================================\\
// ------------------------ STRIPE WEBHOOK ------------------------\\
//=================================================================\\

const st = {
    checkout_completed: async (req, res) => {
        const payload = req.body;

        // ------------ DB INSERT INVOICE ------------ \\
        const invoice_data = payload.data.object;
        const created = (new Date(invoice_data.created * 1000)).toISOString();
        const db_invoice_data = {
            stripe_invoice_id: invoice_data.invoice,
            stripe_client: invoice_data.customer,
            amount: invoice_data.amount_total / 100,
            created,
            currency: invoice_data.currency
        };
        const db_invoice_insert = await DBcall('db_insert_invoice', db_invoice_data);
        if(db_invoice_insert.rowCount != 1) return serverError(res, 'Invoicing error. Code 14'); //TODO: needs to be logged.
    
        // ------------ DB INSERT SUBSCRIPTION ------------ \\
        let expires_at =  (new Date(invoice_data.created * 1000));
        expires_at = new Date(expires_at.setMonth(expires_at.getMonth() + 1)).toISOString(); //calc not to do additional stripe call to Subscriptions
        const db_sub_data = {
            id: invoice_data.subscription,
            stripe_customer: invoice_data.customer,
            period_startdate: created, 
            period_enddate: expires_at,
            invoice_id:invoice_data.invoice
        };
        const db_sub_insert = await DBcall('db_insert_subscription', db_sub_data);
        if(db_sub_insert.rowCount != 1) return serverError(res, 'Subscription error. Code 15'); //TODO: needs to be logged.
        
        // ------------ ADD CREDITS ------------ \\
        const db_add_credits_data = {amount: 3000, stripe_customer_id: invoice_data.customer};
        const db_add_credits_insert = await DBcall('db_add_credits', db_add_credits_data);
        if(db_add_credits_insert.rowCount != 1) return serverError(res, 'Invoicing error. Code 16'); //TODO: needs to be logged.

        res.status(200).end();
    }
}

app.post('/stripe-webhook', async (req, res) => {
    // ------------ CONSUME FROM STRIPE QUEUE ------------ \\
    const payload = req.body;
    switch(payload.type){
        case 'checkout.session.completed':
            st.checkout_completed(req, res);
            break;
    }
    res.status(400).end();
});



async function startServer(){
    const companies = await DBcall('db_getAllCompanies');
    await makeFuse(companies.rows);

    app.listen(PORT, () => {
        console.log('Listening on ' + PORT);
    })
}

export {startServer};