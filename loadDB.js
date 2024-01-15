import company_tickers from './company_tickers.json' assert { type: 'json' };
import dotenv from 'dotenv';
import pkg from 'pg';
import readline from 'readline';
import fs from 'fs'


const {Client} = pkg;
dotenv.config();

let client;
async function DBConn(){
    try {
        client = new Client()
        await client.connect();
        const res = await client.query('SELECT $1::text as message', ['Hello world!'])
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
            await client.query(query);
            query = 'INSERT INTO companies (symbol,name,cik) ';
        }
        query = query + ` SELECT '${obj.ticker}','${obj.title.replaceAll(`'`,`''`)}','${obj.cik_str}' UNION`;

        //await sql.query();
    }
} 

async function matchMcap(){
    const fileStream = fs.createReadStream('./mcap.csv');
    
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    
    rl.on('line', async (line) => {
        // Process each line
        // Skip if it's a header or empty line
        //if (line.startsWith('Header') || line.trim() === '') return;
        const columns = line.split(',').map(x=>x.replaceAll('"','')); // Split line by comma, adjust if your CSV has a different delimiter
        let [id, name, symbol, mcap, price, country] = columns
        if (mcap === 'marketcap') return;
        let query = `update companies set mcap = ${mcap}, country = '${country}' where symbol = '${symbol}'`;
        try{
            await client.query(query)
        }catch(err){console.log(err)}
        // Insert data into PostgreSQL
        // Replace 'your_table' and column names as per your database schema
        // const query = 'INSERT INTO your_table (column1, column2) VALUES ($1, $2)';
        // pool.query(query, [columns[0], columns[1]])
        //     .catch(e => console.error(e.stack));
    });
}
    


DBConn().then(matchMcap);
