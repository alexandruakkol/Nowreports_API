let sql;

//////////////////////// ======= DB operations ======== \\\\\\\\\\\\\\\\\\\\\\\\
const db_ops = {
    db_insertConvo : {
        fn: async (oo) => {
            const {convoID, uid, ticker} = oo;
            const request = new sql.Request();
            request.input('convoID', sql.NVarChar(40), convoID);
            request.input('uid', sql.NVarChar(100), uid);
            request.input('symbol', sql.NVarChar(100), ticker);
            return await request.execute('dbo.insertConversation');
        },
        required_params : ['convoID', 'uid', 'ticker']
    },
    db_getConvo : {
        fn: async (oo) => { //TODO: auth with uid too
            const {convoID} = oo;
            const request = new sql.Request();
            request.input('convoID', sql.NVarChar(40), convoID);
            //request.input('uid', sql.NVarChar(100), uid);
            return await request.execute('dbo.getConversation');
        }, 
        required_params : ['convoID']
    },
    db_getReport : {
        fn: async (oo) => {
            const {cik} = oo;
            const request = new sql.Request();
            request.input('cik', sql.NVarChar(100), cik);
            return await request.execute('dbo.getAnnualReport');
        },
        required_params: ['cik'],
    },

    db_sendMessage : {
        fn: async (oo) => {
            const {convoID, msg} = oo;
            const request = new sql.Request();
            request.input('convoID', sql.NVarChar(40), convoID);
            request.input('msg', sql.NVarChar(500), msg);
            return await request.execute('dbo.sendMessage');
        },
        required_params: ['convoID', 'msg'],
    },

    db_template : {
        fn: async (oo) => {
            const {convoID} = oo;
            const request = new sql.Request();
            request.input('convoID', sql.NVarChar(40), convoID);
            //request.input('uid', sql.NVarChar(100), uid);
            return await request.execute('dbo.getConversation');
        },
        required_params: [],
    }, 
}

//////////////////////// ======= DB methods ======== \\\\\\\\\\\\\\\\\\\\\\\\

function check_required_params(fn_obj, args){
    const {required_params} = fn_obj;
    const fn_name = Object.keys(fn_obj)[0];
    const missing_req_params = required_params.filter(param => !Object.keys(args).includes(param));
    if(!missing_req_params.length) return;
    if(missing_req_params.length === 1) throw new Error(`Missing parameter: ${missing_req_params[0]}`);
    if(missing_req_params.length > 1) throw new Error(`Missing parameters: ${missing_req_params.join(', ')}`);
    
}

async function DBcall(fn_string, args){
    let res;
    try{
        if(!sql) sql = global.appdata.sqlconn;
        if (typeof db_ops[fn_string]?.fn != 'function') return console.error(`Function ${fn_string} does not exist in db_obs`);
        const fn = db_ops[fn_string].fn;
        check_required_params(db_ops[fn_string], args);
        res = await fn(args);
    } catch(err){
        console.log(fn_string && fn_string, err);
        res = {error:true};
    }
    return res;
}

export {DBcall};