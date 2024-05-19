const TRANSCRIPTS_URL = 'https://roic.ai/quote/$SYMBOL/transcripts';

async function getTranscripts(page, symbol){
    const url = TRANSCRIPTS_URL.replace('$SYMBOL', symbol.toUpperCase());
    await page.goto(url, { waitUntil: "domcontentloaded" }, { timeout: 0 });

    let transcripts_data = await page.evaluate(() => {
    
        // call period
        const callTitle = document.querySelector("body > div.flex-col.content-center.items-center > div:nth-child(2) > div.mx-auto.max-w-screen-2xl.space-y-5.px-1.py-4.sm\\:px-6.sm\\:py-10.lg\\:px-8 > div > div.space-y-6.lg\\:col-span-3 > div > div.flex.items-baseline.justify-between.border-b.px-4.py-6.sm\\:px-10 > h3")
        const callPeriod = callTitle?.innerHTML?.split('·')[0]?.trim();

        // convo
        const convo = [];
        const convoParent = document.querySelector("body > div.flex-col.content-center.items-center > div:nth-child(2) > div.mx-auto.max-w-screen-2xl.space-y-5.px-1.py-4.sm\\:px-6.sm\\:py-10.lg\\:px-8 > div > div.space-y-6.lg\\:col-span-3 > div > div.space-y-10.py-10.sm\\:px-5.lg\\:px-10.xl\\:px-20");
        
        for(const message of convoParent.children){
            const agent = message.children[0].children[2].children[0].innerText;
            const text = message.children[0].children[2].children[1].innerText;
            convo.push( {text, agent} );
        }

        return {callPeriod, convo}
    });

    
    return transcripts_data;
}

export {getTranscripts};