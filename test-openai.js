// Test script to verify OpenAI API key is working
require('dotenv').config();
const OpenAI = require('openai');

console.log('Testing OpenAI API connection...\n');

// Check if API key is set
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
  console.error('❌ ERROR: OPENAI_API_KEY is not set or is using placeholder value');
  console.error('   Please set a valid API key in your .env file');
  process.exit(1);
}

console.log('✓ API key found in .env file');
console.log('✓ API key starts with:', process.env.OPENAI_API_KEY.substring(0, 7) + '...\n');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000
});

async function testOpenAI() {
  try {
    console.log('Sending test request to OpenAI...');
    const startTime = Date.now();
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say 'Hello, ToHim is working!' if you can read this." }],
      max_completion_tokens: 50
    });

    const duration = Date.now() - startTime;
    const content = response.choices[0].message.content;
    
    console.log('\n✅ SUCCESS! OpenAI API is working correctly');
    console.log(`   Response time: ${duration}ms`);
    console.log(`   Response: ${content}\n`);
    
  } catch (error) {
    console.error('\n❌ ERROR: OpenAI API test failed\n');
    
    if (error.status === 401) {
      console.error('   Authentication failed - Invalid API key');
      console.error('   Please check your OPENAI_API_KEY in .env file');
    } else if (error.status === 429) {
      console.error('   Rate limit exceeded - Too many requests');
      console.error('   Please wait a moment and try again');
    } else if (error.message.includes('timeout')) {
      console.error('   Request timed out - OpenAI API may be slow');
      console.error('   Error:', error.message);
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('   Cannot connect to OpenAI API');
      console.error('   Please check your internet connection');
    } else {
      console.error('   Error:', error.message);
      console.error('   Status:', error.status);
      console.error('   Full error:', error);
    }
    
    process.exit(1);
  }
}

testOpenAI();


