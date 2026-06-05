import fs from 'fs';
import * as pdfObj from 'pdf-parse';
const pdf = (pdfObj as any).default || pdfObj;

async function readPdf(filePath: string) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  console.log(data.text.substring(0, 500));
}

readPdf('books/zhumanamazy.pdf');
readPdf('books/Oraza_qulshylygy.pdf');
