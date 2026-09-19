const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000, // 2 minutes for audio transcription
});

// Ensure uploads directory exists (relative to server directory)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
// Store files temporarily in uploads directory
const upload = multer({ 
  dest: uploadsDir,
  limits: { 
    fileSize: 25 * 1024 * 1024 // 25MB limit (Whisper supports up to 25MB)
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    const allowedMimes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 
      'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-m4a'
    ];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|webm|ogg|flac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload an audio file.'));
    }
  }
});

// Transcribe audio file using OpenAI Whisper
router.post('/', upload.single('audio'), async (req, res) => {
  let filePath = null;
  let finalFilePath = null;
  let convertedFilePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    filePath = req.file.path;
    console.log('[Transcribe] Received audio file:', req.file.originalname, req.file.mimetype);
    console.log('[Transcribe] File size:', req.file.size, 'bytes');
    console.log('[Transcribe] Temporary path:', filePath);

    // Validate file size - ensure it's not empty
    if (!req.file.size || req.file.size === 0) {
      return res.status(400).json({ 
        error: 'Audio file is empty',
        details: 'The uploaded file has no content. Please ensure you recorded audio for at least a few seconds.'
      });
    }

    // Validate API key
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        details: 'Please set OPENAI_API_KEY in your .env file'
      });
    }
    
    // Verify file exists and is readable
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ 
        error: 'File not found',
        details: 'The uploaded file could not be found on the server.'
      });
    }
    
    // Check file size matches what was uploaded
    const actualFileSize = fs.statSync(filePath).size;
    if (actualFileSize === 0) {
      return res.status(400).json({ 
        error: 'Audio file is empty',
        details: 'The uploaded file has no content. Please ensure you recorded audio for at least a few seconds.'
      });
    }
    console.log('[Transcribe] Actual file size:', actualFileSize, 'bytes');

    // Determine the correct file extension
    const supportedExts = ['.m4a', '.mp3', '.wav', '.webm', '.ogg', '.flac', '.mp4', '.mpeg', '.mpga', '.oga'];
    const originalExt = path.extname(req.file.originalname || '').toLowerCase();
    const tempExt = path.extname(filePath).toLowerCase();
    
    // Determine target extension
    let targetExt = originalExt || tempExt;
    
    // If no recognized extension, default to .m4a (common for mobile recordings)
    if (!targetExt || !supportedExts.includes(targetExt)) {
      targetExt = '.m4a';
      console.log('[Transcribe] No recognized extension, defaulting to .m4a');
    }
    
    // Rename file to have correct extension if needed
    finalFilePath = filePath;
    if (tempExt !== targetExt) {
      finalFilePath = filePath + targetExt;
      fs.renameSync(filePath, finalFilePath);
      console.log('[Transcribe] Renamed file to:', finalFilePath, 'with extension:', targetExt);
    }

    // Convert .m4a files to .mp3 for better Whisper compatibility
    // Whisper sometimes has issues with certain .m4a codecs
    let convertedFilePath = finalFilePath;
    const needsConversion = targetExt === '.m4a' || targetExt === '.m4v';
    
    if (needsConversion) {
      try {
        // Check if ffmpeg is available
        console.log('[Transcribe] Attempting to convert .m4a to .mp3 for Whisper compatibility...');
        convertedFilePath = finalFilePath.replace(/\.m4a?$/i, '.mp3');
        
        await new Promise((resolve, reject) => {
          const command = ffmpeg(finalFilePath)
            .toFormat('mp3')
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .on('end', () => {
              console.log('[Transcribe] Audio conversion successful');
              resolve();
            })
            .on('error', (err) => {
              // Check if it's an ffmpeg not found error
              if (err.message && err.message.includes('ffmpeg')) {
                console.warn('[Transcribe] FFmpeg not found. Install ffmpeg for audio conversion:');
                console.warn('[Transcribe]   macOS: brew install ffmpeg');
                console.warn('[Transcribe]   Linux: apt-get install ffmpeg or yum install ffmpeg');
                console.warn('[Transcribe]   Windows: Download from https://ffmpeg.org/download.html');
                console.warn('[Transcribe] Attempting to use original .m4a file (may fail if codec is unsupported)');
              } else {
                console.error('[Transcribe] FFmpeg conversion error:', err.message || err);
              }
              // If conversion fails, try using original file
              convertedFilePath = finalFilePath;
              resolve(); // Don't reject, try with original file
            })
            .save(convertedFilePath);
        });
        
        // Verify converted file exists and has content
        if (fs.existsSync(convertedFilePath) && fs.statSync(convertedFilePath).size > 0) {
          console.log('[Transcribe] Using converted .mp3 file');
          // Clean up original .m4a file if conversion succeeded
          if (convertedFilePath !== finalFilePath && fs.existsSync(finalFilePath)) {
            fs.unlinkSync(finalFilePath);
          }
          finalFilePath = convertedFilePath;
          targetExt = '.mp3';
        } else {
          console.log('[Transcribe] Converted file invalid, using original .m4a file');
          convertedFilePath = finalFilePath;
        }
      } catch (conversionError) {
        console.error('[Transcribe] Error during conversion, using original file:', conversionError.message || conversionError);
        convertedFilePath = finalFilePath;
      }
    }

    // Send the audio file to OpenAI Whisper.
    // The SDK infers the format from the file stream and extension.
    console.log('[Transcribe] Sending to OpenAI Whisper...');
    console.log('[Transcribe] Final file path:', finalFilePath);
    console.log('[Transcribe] File extension:', targetExt);
    console.log('[Transcribe] File size (bytes):', fs.statSync(finalFilePath).size);

    const fileStream = fs.createReadStream(finalFilePath);

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      language: 'en', // Optional: specify language for better accuracy
      response_format: 'text', // Get plain text response
    });

    console.log('[Transcribe] Transcription successful');
    console.log('[Transcribe] Transcript length:', transcription.length, 'characters');

    // Clean up uploaded files
    if (convertedFilePath && convertedFilePath !== filePath && fs.existsSync(convertedFilePath)) {
      try {
        fs.unlinkSync(convertedFilePath);
      } catch (unlinkError) {
        console.error('[Transcribe] Error deleting converted file:', unlinkError);
      }
    }
    if (finalFilePath && finalFilePath !== filePath && fs.existsSync(finalFilePath)) {
      try {
        fs.unlinkSync(finalFilePath);
      } catch (unlinkError) {
        console.error('[Transcribe] Error deleting final file:', unlinkError);
      }
    }
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        console.error('[Transcribe] Error deleting temp file:', unlinkError);
      }
    }
    filePath = null;
    finalFilePath = null;
    convertedFilePath = null;

    res.json({
      transcript: transcription,
      success: true
    });

  } catch (error) {
    console.error('[Transcribe] Error transcribing audio:', error);
    
    // Clean up files if they still exist
    const filesToClean = [filePath, finalFilePath, convertedFilePath].filter(Boolean);
    for (const file of filesToClean) {
      if (file && fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch (unlinkError) {
          console.error('[Transcribe] Error deleting file:', file, unlinkError);
        }
      }
    }

    // Provide helpful error messages
    let errorMessage = 'Failed to transcribe audio';
    let statusCode = 500;

    if (error.response) {
      // OpenAI API error
      if (error.response.status === 401) {
        errorMessage = 'Invalid OpenAI API key';
        statusCode = 401;
      } else if (error.response.status === 429) {
        errorMessage = 'OpenAI API rate limit exceeded. Please try again later.';
        statusCode = 429;
      } else if (error.response.status === 400) {
        // Format error
        errorMessage = error.response.data?.error?.message || 'Invalid audio file format';
        statusCode = 400;
      } else {
        errorMessage = error.response.data?.error?.message || errorMessage;
      }
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;
