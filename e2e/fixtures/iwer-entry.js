// Test only: the Immersive Web Emulation Runtime (IWER, MIT, Meta) as a WebXR device, so
// VR runs in headless Chromium. Never part of a shipped bundle.
import { XRDevice, metaQuest3 } from 'iwer';

const device = new XRDevice(metaQuest3);
device.installRuntime({ forceInstall: true });
window.__xrDevice = device;
