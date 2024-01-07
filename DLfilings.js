import company_tickers from './company_tickers.json' assert { type: 'json' };
import {getDocNumber} from './server.js';

async function startDL(){
    for(const obj of Object.values(company_tickers).slice(0,25)){
        const ticker = obj.ticker;
        const sql = global.sqlconn;

        const cik = (await sql.query(`SELECT top 1 cik from companies where symbol='${ticker}'`)).recordset[0].cik;
        await getDocNumber({cik, year:2019, type:'annual'});
    }
    
}

export {startDL};