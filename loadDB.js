import company_tickers from './company_tickers.json' assert { type: 'json' };
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config();

async function DBConn(){
    try {
        await sql.connect(process.env.DBCONNSTR);
        const result = await sql.query`select 1;`;
        if(result.rowsAffected?.[0] == 1) console.log('Azure DB conn OK');
    } catch (err) {
        console.log(err);
    }
}

async function startMove(){
    const companyObjects = Object.values(company_tickers);
    
    let counter = 0;
    let query = 'INSERT INTO companies (symbol,name,cik) ';
    for(const obj of companyObjects){
        counter++;
        if( ((counter % 40) == 0) || (counter == companyObjects.length) ){
            query = query.slice(0,-5); 
            console.log(counter, query);
            await sql.query(query);
            query = 'INSERT INTO companies (symbol,name,cik) ';
        }
        
        query = query + ` SELECT '${obj.ticker}','${obj.title.replaceAll(`'`,`''`)}','${obj.cik_str}' UNION`;
    
        //await sql.query();
    }
}

DBConn().then(startMove);
