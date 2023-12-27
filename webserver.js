import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();
const PORT = 8000;
const app = express();
app.use(cors());
app.use(express.json());

async function DBConn(){
    try {
        await sql.connect(process.env.DBCONNSTR);
        const result = await sql.query`select 1;`;
        if(result.rowsAffected?.[0] == 1) console.log('Azure DB conn OK');
    } catch (err) {
        console.log(err);
    }
}

async function startServer(){
    
    await DBConn();
    
    app.listen(PORT, () => {
        console.log('Listening on ' + PORT);
    })
    
}


app.post('/createAccount', async (req, res) => {

    function incompleteRequest(){
        res.statusCode = 400;
        res.json({error:'incomplete request'});
    }
    console.log(req.body);
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
    res.send();
});

startServer();