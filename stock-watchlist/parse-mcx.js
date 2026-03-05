const axios = require('axios');
const fs = require('fs');

async function testMcNextData() {
    try {
        const html = fs.readFileSync('mc.html', 'utf8');
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (match && match[1]) {
            const data = JSON.parse(match[1]);
            fs.writeFileSync('mc_json.json', JSON.stringify(data, null, 2));
            console.log("Extracted next_data");

            // let's look for gold details inside
            function findGold(obj, path = "$") {
                if (typeof obj !== 'object' || obj === null) return;
                if (Array.isArray(obj)) {
                    obj.forEach((v, i) => findGold(v, `${path}[${i}]`));
                } else {
                    for (let k in obj) {
                        if (typeof obj[k] === 'string' && obj[k].toLowerCase().includes('gold')) {
                            console.log(`Found gold at ${path}.${k}: ${obj[k].substring(0, 100)}`);
                            // If it's a symbol, we might want to log the whole object
                            if (k === 'symbol' || k === 'name' || k === 'commodity') {
                                console.log("Object:", obj);
                            }
                        }
                        findGold(obj[k], `${path}.${k}`);
                    }
                }
            }
            findGold(data);
        } else {
            console.log("not found");
        }
    } catch (e) { console.error(e); }
}
testMcNextData();
