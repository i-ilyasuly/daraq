const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const pdf2img = require('pdf-img-convert');

const storage = new Storage();

// Орта айнымалыларынан bucket атауын аламыз (deploy кезінде орнатылады)
const processedBucketName = process.env.PROCESSED_BUCKET_NAME;

// Cloud Storage (Eventarc) триггері: Landing Bucket-ке жаңа файл түскенде оянады
functions.cloudEvent('processNewPdf', async (cloudEvent) => {
  const fileData = cloudEvent.data;
  
  const landingBucketName = fileData.bucket;
  const fileName = fileData.name;
  
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    console.log(`Кешіріңіз, ${fileName} PDF форматында емес. Жұмыс тоқтатылды.`);
    return;
  }
  
  if (!processedBucketName) {
    throw new Error("PROCESSED_BUCKET_NAME орта айнымалысы табылмады!");
  }

  // Кеңейтілімсіз кітап атын алу (мысалы: "Sapar_fiqhy.pdf" -> "Sapar_fiqhy")
  const bookName = path.parse(fileName).name;

  const tempFilePath = path.join(os.tmpdir(), fileName);

  try {
    console.log(`[1/4] Жүктеп алынуда... Букет: ${landingBucketName}, Файл: ${fileName}`);
    await storage.bucket(landingBucketName).file(fileName).download({ destination: tempFilePath });
    
    console.log(`[2/4] Суретке айналдыру басталды (pdf-img-convert арқылы)... Кітап: ${bookName}`);
    console.log("Беттерді кесу басталды. Бұл кітап қалыңдығына байланысты уақыт алуы мүмкін...");
    
    // pdf-img-convert баптаулары: width сапалы A4 өлшемі үшін 1200 деп аламыз
    const pdfArray = await pdf2img.convert(tempFilePath, {
      width: 1200
    });
    
    console.log(`[3/4] Айналдыру аяқталды. Табылған беттер саны: ${pdfArray.length}`);
    
    const processedBucket = storage.bucket(processedBucketName);
    
    // Әр суретті (Buffer) тікелей Processed-Images букетіне жүктеу
    // Файл атауы: [book_id]/page_[page_num].png
    for (let i = 0; i < pdfArray.length; i++) {
       const pageNum = i + 1; // массив 0-ден басталады, беттерді 1-ден бастатамыз
       const imageBuffer = Buffer.from(pdfArray[i]);
       const destinationBlobName = `${bookName}/page_${pageNum}.png`;
       
       console.log(`Жүктелуде: ${destinationBlobName} ...`);
       
       // .save() сурет буферін GCS-ке уақытша файлсыз-ақ тікелей жазады
       await processedBucket.file(destinationBlobName).save(imageBuffer, {
          contentType: 'image/png'
       });
    }
    
    console.log(`[4/4] Жетістік! ${bookName} кітабының барлық парақтары сәтті кесіліп, ${processedBucketName} ішіне жүктелді.`);
    
  } catch (error) {
    console.error(`Қате орын алды:`, error);
  } finally {
    // Уақытша PDF файлды өшіру (GCP Cloud Function жады толып кетпеуі үшін /tmp/ тазарту)
    try {
      await fs.unlink(tempFilePath);
    } catch(e) {}
  }
});

