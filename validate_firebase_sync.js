#!/usr/bin/env node

// Validación simple: verifica que todas las funciones de escritura tengan syncToFirebase

const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, 'script.js');
const content = fs.readFileSync(scriptPath, 'utf8');

// Funciones principales que escriben datos
const writeFunctions = [
    { name: 'addPost', dataKey: 'posts' },
    { name: 'sendReply', dataKey: 'posts' },
    { name: 'deletePost', dataKey: 'posts' },
    { name: 'deleteReply', dataKey: 'posts' },
    { name: 'editPost', dataKey: 'posts' },
    { name: 'editReply', dataKey: 'posts' },
    { name: 'sendPrivateMessage', dataKey: 'privateChats' },
    { name: 'editPrivateMsg', dataKey: 'privateChats' },
    { name: 'deletePrivateMsg', dataKey: 'privateChats' },
    { name: 'createGroup', dataKey: 'groups' },
    { name: 'sendGroupMessage', dataKey: 'groups' },
    { name: 'editGroupMsg', dataKey: 'groups' },
    { name: 'deleteGroupMsg', dataKey: 'groups' },
    { name: 'deleteGroup', dataKey: 'groups' },
    { name: 'addMemberToGroup', dataKey: 'groups' },
    { name: 'toggleModerator', dataKey: 'users' },
    { name: 'addModLog', dataKey: 'modLog' },
    { name: 'toggleMutePrompt', dataKey: 'muted' },
    { name: 'isMuted', dataKey: 'muted' },
];

let issues = [];

writeFunctions.forEach(func => {
    // Find function definition
    const funcRegex = new RegExp(`function\\s+${func.name}\\s*\\(`, 'g');
    if (!funcRegex.test(content)) {
        return; // Function doesn't exist, skip
    }

    // Check if there's a syncToFirebase call with the correct key in this function
    const funcIndex = content.indexOf(`function ${func.name}(`);
    const nextFuncIndex = content.indexOf('\nfunction ', funcIndex + 1);
    const funcContent = nextFuncIndex === -1 ? content.slice(funcIndex) : content.slice(funcIndex, nextFuncIndex);
    
    const hasSync = new RegExp(`syncToFirebase\\s*\\(\\s*['"]${func.dataKey}['"]`, 'g').test(funcContent);
    
    if (!hasSync) {
        issues.push(`⚠️  Function '${func.name}' writes '${func.dataKey}' but may not have syncToFirebase call`);
    } else {
        console.log(`✓ ${func.name} has syncToFirebase('${func.dataKey}')`);
    }
});

if (issues.length > 0) {
    console.log('\n' + '='.repeat(50));
    console.log('POTENTIAL ISSUES FOUND:');
    console.log('='.repeat(50));
    issues.forEach(issue => console.log(issue));
    process.exit(1);
} else {
    console.log('\n✓ All write functions appear to have Firebase sync!');
    process.exit(0);
}
