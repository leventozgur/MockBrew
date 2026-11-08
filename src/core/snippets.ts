import os from 'node:os';
import type { Snippet } from './view.js';

export type { Snippet } from './view.js';

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

/** Debug-only network setup for emulators, simulators and devices. Production config is never touched. */
export function connectionSnippets(port: number, lan: string[] = lanAddresses()): Snippet[] {
  const lanIp = lan[0] ?? '<your-lan-ip>';
  return [
    {
      id: 'android-emulator',
      title: 'Android Emulator',
      description: 'The emulator reaches the host machine at 10.0.2.2. The mock listener may stay on 127.0.0.1.',
      language: 'text',
      code: `http://10.0.2.2:${port}/`,
    },
    {
      id: 'android-device',
      title: 'Android device (USB)',
      description: 'Forward the port with adb; no LAN access is needed. Run again after reconnecting the device.',
      language: 'shell',
      code: `adb reverse tcp:${port} tcp:${port}\n# then use http://localhost:${port}/ in the app`,
    },
    {
      id: 'ios-simulator',
      title: 'iOS Simulator',
      description: 'The simulator shares the host network, so localhost works.',
      language: 'text',
      code: `http://localhost:${port}/`,
    },
    {
      id: 'ios-device',
      title: 'iOS device (same Wi-Fi)',
      description: 'Requires LAN access: enable it explicitly in the project settings (host 0.0.0.0). Anyone on the network can then reach the mock.',
      language: 'text',
      code: `http://${lanIp}:${port}/`,
    },
    {
      id: 'android-cleartext',
      title: 'Android: allow cleartext to the mock (debug only)',
      description: 'targetSdk 28+ blocks http by default. Add this file to the debug source set only.',
      language: 'xml',
      location: 'app/src/debug/res/xml/network_security_config.xml',
      code: `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
</network-security-config>`,
    },
    {
      id: 'android-manifest',
      title: 'Android: reference the config in the debug manifest',
      description: 'Only the debug manifest overlay references it, so release builds stay untouched.',
      language: 'xml',
      location: 'app/src/debug/AndroidManifest.xml',
      code: `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:networkSecurityConfig="@xml/network_security_config" />
</manifest>`,
    },
    {
      id: 'ios-ats',
      title: 'iOS: allow local networking (debug only)',
      description: 'Add to the Info.plist used by the Debug configuration when http requests to the mock are blocked.',
      language: 'xml',
      location: 'Debug Info.plist',
      code: `<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>`,
    },
    {
      id: 'kotlin-base-url',
      title: 'Kotlin: debug base URL',
      description: 'Select the mock per build type instead of editing the production URL.',
      language: 'kotlin',
      location: 'app/build.gradle.kts',
      code: `android {
    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\\"http://10.0.2.2:${port}/\\"")
        }
    }
}`,
    },
    {
      id: 'swift-base-url',
      title: 'Swift: debug base URL',
      description: 'Compile the mock URL into Debug builds only.',
      language: 'swift',
      code: `#if DEBUG
let apiBaseURL = URL(string: "http://localhost:${port}/")!
#else
let apiBaseURL = URL(string: "https://api.example.com/")!
#endif`,
    },
  ];
}
