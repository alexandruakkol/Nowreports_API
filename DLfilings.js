import company_tickers from './company_tickers.json' assert { type: 'json' };
import {getDocNumber, sendErrorCIKToDB} from './server.js';

async function startFilingsDownload(oo){
    let toDL_list;
    const sql = global.sqlconn;
    if(oo.mode == 'update') toDL_list = (await sql.query(`select cik from companies order by mcap desc`))?.recordset;
    if(oo.mode.startsWith('append') ) toDL_list = (await sql.query(`
        select c.cik 
        from companies c
        left join filings f on (f.cik=c.cik and f.year >= datepart(year, getdate())-1 )
        where f.cik is null 
        order by mcap desc
        `))?.recordset;
        
    toDL_list = toDL_list.map(x=>x.cik);

    if(oo.mode.includes('reverse')) toDL_list.sort();

    console.log(`Pulling ${toDL_list.length} tickers`);

    console.log(toDL_list);

    for(const cik of toDL_list){
        console.log('pulling ', cik);
        try{
            await getDocNumber({cik, type:'annual'});
        }
        catch(err){
            console.log(err);
            sendErrorCIKToDB({cik, typ:'10-K'});
        }
        console.log('pulled ', cik);

    }
    
}

export {startFilingsDownload};