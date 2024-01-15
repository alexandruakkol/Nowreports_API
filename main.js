import dotenv from 'dotenv';
import sql from 'mssql';
import {startFilingsDownload} from './DLfilings.js';
import {startServer} from './webserver.js';

dotenv.config();

async function start(){
    try {
        //--------------- GLOBALS ---------------
        global.appdata={};
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
