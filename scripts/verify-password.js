// scripts/verify-password.js
import { compare, hash as _hash } from 'bcryptjs';

const password = 'IslamicResearch2025!@#$Secure';
const hash = '$2b$12$hCjKQHYqWjuiVNl.9Fvbm.SH7reJbjGqga36T4JgSaeGdoHC1nrOu';

console.log('Testing password verification...\n');
console.log('Password:', password);
console.log('Hash:', hash);

compare(password, hash).then(result => {
  console.log('\n✅ Password matches hash:', result);
  
  if (!result) {
    console.log('\n⚠️  Hash does not match! Generating new hash...');
    return _hash(password, 12);
  }
}).then(newHash => {
  if (newHash) {
    console.log('\n🔑 New hash for .env.local:');
    console.log(`AUTH_PASSWORD_HASH=${newHash}`);
  }
});