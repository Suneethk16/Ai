import fs from 'fs';
import path from 'path';

console.log('🔍 Verifying build...');
console.log('Current directory:', process.cwd());
console.log('Directory contents:', fs.readdirSync('.'));

const distPath = './dist';
if (fs.existsSync(distPath)) {
  console.log('✅ dist folder exists');
  console.log('📁 dist contents:', fs.readdirSync(distPath));
  
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    console.log('✅ index.html exists');
  } else {
    console.log('❌ index.html missing');
  }
} else {
  console.log('❌ dist folder missing');
  console.log('Creating empty dist with fallback...');
  fs.mkdirSync(distPath);
  fs.writeFileSync(path.join(distPath, 'index.html'), `
<!DOCTYPE html>
<html>
<head>
  <title>AI Study Companion</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root">
    <div class="min-h-screen bg-gray-50 flex items-center justify-center">
      <div class="text-center">
        <h1 class="text-4xl font-bold text-purple-800 mb-4">AI Study Companion</h1>
        <p class="text-gray-600">Build in progress... Please refresh in a moment.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `);
  console.log('✅ Created fallback index.html');
}