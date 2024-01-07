import dotenv from 'dotenv';
import sql from 'mssql';
import { startServer } from './webserver.js';
import {startDL} from './DLfilings.js';

dotenv.config();

async function start(){
    try {
        //--------------- DB CONN ---------------
        await sql.connect(process.env.DBCONNSTR);
        const result = await sql.query`select 1;`;
        if(result.rowsAffected?.[0] == 1) console.log('Azure DB conn OK');
        global.sqlconn = sql;
        //--------------- MODULE START ---------------
        startServer();
        //startDL();
    } catch (err) {
        console.log(err);
    }
    return sql;
}

start()
