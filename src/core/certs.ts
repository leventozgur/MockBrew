import { createHash, generateKeyPair, randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import os from 'node:os';
import { isIP } from 'node:net';
import path from 'node:path';
import { lanAddresses } from './snippets.js';

const forge = createRequire(import.meta.url)('node-forge');
const generateRsa = promisify(generateKeyPair);


export function certificatePaths(project: string, home = os.homedir()) {
  const dir = path.join(home, '.mockbrew', 'certs', createHash('sha256').update(path.resolve(project)).digest('hex'));
  return { dir, ca: path.join(dir, 'ca.pem'), caKey: path.join(dir, 'ca-key.pem'), cert: path.join(dir, 'server.pem'), key: path.join(dir, 'server-key.pem') };
}

export async function createCertificates(project: string, home = os.homedir()): Promise<void> {
  const p = certificatePaths(project, home);
  const projectPath = path.resolve(project);
  if (p.dir === projectPath || p.dir.startsWith(projectPath + path.sep)) throw new Error('Certificate storage must be outside the project folder.');
  mkdirSync(path.dirname(p.dir), { recursive: true, mode: 0o700 });
  try { mkdirSync(p.dir, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Certificates already exist. Delete them explicitly before creating replacements.');
    throw error;
  }
  try {
    const ipv6 = Object.values(os.networkInterfaces()).flatMap((entries) => (entries ?? []).filter((entry) => !entry.internal && entry.family === 'IPv6').map((entry) => entry.address.split('%')[0]!).filter((ip) => isIP(ip) === 6));
    const ips = [...new Set(['127.0.0.1', '::1', '10.0.2.2', ...lanAddresses(), ...ipv6])];
    // RSA 2048 with SHA-256 is supported by Android and iOS and preserves the existing certificate algorithm.
    const options = { modulusLength: 2048, publicKeyEncoding: { type: 'spki' as const, format: 'pem' as const }, privateKeyEncoding: { type: 'pkcs1' as const, format: 'pem' as const } };
    const [caKeys, serverKeys] = await Promise.all([generateRsa('rsa', options), generateRsa('rsa', options)]);
    const caPrivate = forge.pki.privateKeyFromPem(caKeys.privateKey);
    const makeCert = (publicKey: string, name: string, days: number) => {
      const cert = forge.pki.createCertificate();
      cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
      cert.serialNumber = `01${randomBytes(19).toString('hex')}`;
      cert.validity.notBefore = new Date();
      cert.validity.notAfter = new Date(cert.validity.notBefore.getTime() + days * 86400000);
      cert.setSubject([{ name: 'commonName', value: name }]);
      return cert;
    };
    const ca = makeCert(caKeys.publicKey, 'MockBrew Local CA', 3650);
    ca.setIssuer(ca.subject.attributes);
    ca.setExtensions([{ name: 'basicConstraints', critical: true, cA: true }, { name: 'keyUsage', critical: true, keyCertSign: true, cRLSign: true }]);
    ca.sign(caPrivate, forge.md.sha256.create());
    const server = makeCert(serverKeys.publicKey, 'localhost', 825);
    server.setIssuer(ca.subject.attributes);
    server.setExtensions([
      { name: 'basicConstraints', critical: true, cA: false },
      { name: 'keyUsage', critical: true, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))] },
    ]);
    server.sign(caPrivate, forge.md.sha256.create());
    // Windows has no POSIX file modes; private keys rely on the user profile ACL.
    const writeKey = (file: string, key: string) => {
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, key, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    };
    writeKey(p.caKey, caKeys.privateKey);
    writeKey(p.key, serverKeys.privateKey);
    writeFileSync(p.ca, forge.pki.certificateToPem(ca));
    writeFileSync(p.cert, forge.pki.certificateToPem(server));
  } catch (error) {
    rmSync(p.dir, { recursive: true, force: true });
    throw new Error('Certificate creation failed.', { cause: error });
  }
}

export function showCertificates(project: string, home = os.homedir()) {
  const p = certificatePaths(project, home);
  if (!existsSync(p.ca) || !existsSync(p.cert) || !existsSync(p.key)) return { exists: false as const };
  const cert = new X509Certificate(readFileSync(p.cert));
  return { exists: true as const, caPath: p.ca, validTo: cert.validTo, subjectAltName: cert.subjectAltName };
}

export function deleteCertificates(project: string, home = os.homedir()): void {
  rmSync(certificatePaths(project, home).dir, { recursive: true, force: true });
}
