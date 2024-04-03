import fs from 'fs';

fs.readFile('./bge_training_data.jsonl', (err, data)=> {
   const strarr = data.toString().split('\n');
   let largestr = '';
   for(let json of strarr){
        try{
            json = JSON.parse(json);
            
        } catch(er){
            continue;
        }
        delete json.neg;

        let newstr = JSON.stringify(json);
        largestr += '\n' + newstr;
    }
    console.log(largestr);
    fs.writeFile('./bge_new.jsonl', largestr, {}, ()=>{});
});