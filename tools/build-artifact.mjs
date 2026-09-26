// Produces dist/ for hosting environments that wrap the page in their own
// <html>/<head>/<body> skeleton: index.html keeps only what sits between the
// BEGIN/END APP markers plus <title>, fonts and stylesheet. css/ and js/ are
// copied unchanged. For normal hosting just serve the project folder.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';

const src = readFileSync('index.html', 'utf8');
const head = src.match(/<title>[\s\S]*?<link rel="stylesheet" href="css\/style.css">/)[0];
const body = src.match(/<!-- BEGIN APP -->([\s\S]*?)<!-- END APP -->/)[1];
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', `${head}\n${body.trim()}\n`);
cpSync('css', 'dist/css', { recursive: true });
cpSync('js', 'dist/js', { recursive: true });
console.log('dist/ ready');
