import {getDocNumber, sendErrorCIKToDB} from './server.js';
import {sql, DBcall} from './DBops.js';
import Childprocess from 'child_process';
const {exec} = Childprocess;

async function startFilingsDownload(oo){
    let toDL_list;

    if(oo.mode == 'update') toDL_list = (await sql.query(`select cik from companies where country='United States' order by mcap desc limit 50`))?.rows;
    if(oo.mode.startsWith('append') ) toDL_list = (await sql.query(`   
       select c.cik 
        from companies c
        left join filings f on (f.cik=c.cik)
        where f.cik is null and c.country='United States'
        order by mcap desc
        limit 50
    `))?.rows;

    toDL_list = toDL_list.map(x => x.cik);

    if(oo.mode.includes('reverse')) toDL_list.sort();

    console.log(`Pulling ${toDL_list.length} tickers`);

    for(const cik of toDL_list){
        console.log('pulling ', cik);
        let cleanupCounter = 0;
        try{
            await getDocNumber({cik, type:'annual'});
        }
        catch(err){
            console.log('COULD NOT PULL CIK ', cik, err);
            //DBcall('db_insertFiling', {cik, typ:'10-K', reportURL:'', date:''} );
        } finally {
            if(process.env.NODE_ENV === 'production') {
                cleanupCounter++;
                if(cleanupCounter === 5) {
                    cleanupCounter = 0;
                    const command = `rm -rf ~/snap/chromium/common/chromium/DeferredBrowserMetrics/*`;
                    exec(command, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`browser cleanup error: ${error.message}`);
                            return;
                        }
                        if (stderr) {
                            console.error(`browser cleanup stderr: ${stderr}`);
                            return;
                        }
                    });
                }
            }
        }
        console.log('pulled ', cik);
    }
    console.log('-----Scheduled restart-----')
    process.exit();
}

export {startFilingsDownload};