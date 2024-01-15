import {getDocNumber, sendErrorCIKToDB} from './server.js';
import {sql, DBcall} from './DBops.js';

async function startFilingsDownload(oo){
    let toDL_list;

    if(oo.mode == 'update') toDL_list = (await sql.query(`select cik from companies where country='United States' order by mcap desc`))?.rows;
    if(oo.mode.startsWith('append') ) toDL_list = (await sql.query(`   
       select c.cik 
        from companies c
        left join filings f on (f.cik=c.cik)
        where f.cik is null and c.country='United States'
        order by mcap desc
    `))?.rows;

    toDL_list = toDL_list.map(x => x.cik);

    if(oo.mode.includes('reverse')) toDL_list.sort();

    console.log(`Pulling ${toDL_list.length} tickers`);

    for(const cik of toDL_list){
        console.log('pulling ', cik);
        try{
            await getDocNumber({cik, type:'annual'});
        }
        catch(err){
            console.log(err);
            DBcall('db_insertFiling', {cik, typ:'10-K', reportURL:'', year: '', date:''} );
        }
        console.log('pulled ', cik);
    }
}

export {startFilingsDownload};