import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { isIP } from 'node:net';
import path from 'node:path';
import { lanAddresses } from './snippets.js';

export function certificatePaths(project: string, home = os.homedir()) {
  const dir = path.join(home, '.mockbrew', 'certs', createHash('sha256').update(path.resolve(project)).digest('hex'));
  return { dir, ca: path.join(dir, 'ca.pem'), caKey: path.join(dir, 'ca-key.pem'), cert: path.join(dir, 'server.pem'), key: path.join(dir, 'server-key.pem') };
}

export function createCertificates(project: string, home = os.homedir()): void {
  const p = certificatePaths(project, home);
  if (existsSync(p.dir)) throw new Error('Certificates already exist. Delete them explicitly before creating replacements.');
  const projectPath = path.resolve(project);
  if (p.dir === projectPath || p.dir.startsWith(projectPath + path.sep)) throw new Error('Certificate storage must be outside the project folder.');
  mkdirSync(p.dir, { recursive: true, mode: 0o700 });
  const run = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
  try {
    const ipv6 = Object.values(os.networkInterfaces()).flatMap((entries) => (entries ?? []).filter((entry) => !entry.internal && entry.family === 'IPv6').map((entry) => entry.address.split('%')[0]!).filter((ip) => isIP(ip) === 6));
    const ips = [...new Set(['127.0.0.1', '::1', '10.0.2.2', ...lanAddresses(), ...ipv6])];
    const config = path.join(p.dir, 'extensions.cnf');
    writeFileSync(config, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,${ips.map((ip) => `IP:${ip}`).join(',')}\n`, { mode: 0o600 });
    run(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', p.caKey]);
    chmodSync(p.caKey, 0o600);
    run(['req', '-x509', '-new', '-key', p.caKey, '-sha256', '-days', '3650', '-subj', '/CN=MockBrew Local CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', p.ca]);
    run(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', p.key]);
    chmodSync(p.key, 0o600);
    const csr = path.join(p.dir, 'server.csr');
    run(['req', '-new', '-key', p.key, '-subj', '/CN=localhost', '-out', csr]);
    run(['x509', '-req', '-in', csr, '-CA', p.ca, '-CAkey', p.caKey, '-CAcreateserial', '-days', '825', '-sha256', '-extfile', config, '-out', p.cert]);
    rmSync(csr); rmSync(config); rmSync(path.join(p.dir, 'ca.srl'), { force: true });
  } catch (error) {
    rmSync(p.dir, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('OpenSSL is required to create certificates. Install it and try again.');
    throw new Error('Certificate creation failed. Check that OpenSSL is installed and supports the required options.');
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
