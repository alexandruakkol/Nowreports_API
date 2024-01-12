import dotenv from 'dotenv';
import sql from 'mssql';
import {startFilingsDownload} from './DLfilings.js';
import { startServer } from './webserver.js';

dotenv.config();

async function start(){
    try {
        //--------------- DB CONN ---------------
        await sql.connect(process.env.DBCONNSTR);
        const result = await sql.query`select 1;`;
        if(result.rowsAffected?.[0] == 1) console.log('Azure DB conn OK');
        //--------------- GLOBALS ---------------
        global.appdata={};
        global.appdata.sqlconn = sql;
        global.appdata.SEC_BASEURL = 'https://www.sec.gov/Archives/edgar/data/';
        //--------------- MODULE START ---------------
        startServer();
        //--------------- CUSTOM APPS ---------------
        if(process.argv[2] === 'populate-append') startFilingsDownload({mode:'append'});
        if(process.argv[2] === 'populate-update') startFilingsDownload({mode:'update'});
        if(process.argv[2] === 'populate-append-reverse') startFilingsDownload({mode:'append-reverse'});
    } catch (err) {
        console.log(err);
    }
    return sql;
}

start()
