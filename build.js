import { build } from 'vite';
import fs from 'fs';

console.log('Starting build process...');

try {
  await build();
  
  // Check if dist folder was created
  if (fs.existsSync('./dist')) {
    console.log('✅ Build successful - dist folder created');
    console.log('📁 Contents:', fs.readdirSync('./dist'));
  } else {
    console.log('❌ Build failed - no dist folder');
  }
} catch (error) {
  console.error('Build error:', error);
  process.exit(1);
}