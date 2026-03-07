const txt = `"SYMBOL","COMPANY NAME","SERIES","PURPOSE","FACE VALUE","EX-DATE","RECORD DATE","BOOK CLOSURE START DATE","BOOK CLOSURE END DATE"
"SBICARDS","SBI Cards and Payment Services Limited","EQ","Interim Dividend","10","09-Mar-2026","10-Mar-2026","-","-"`;

function parseCSV(text) {
  const lines = text.split('\n');
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // simple CSV split considering quotes
    const regex = /(".*?"|[^",]+)(?=\s*,|\s*$)/g;
    const parts = [];
    let match;
    while (match = regex.exec(line)) {
      parts.push(match[1].replace(/^"|"$/g, '').trim());
    }
    results.push(parts);
  }
  return results;
}

console.log(parseCSV(txt));
