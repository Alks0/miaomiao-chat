/**
 * AndroidInstaller Plugin Registration (JavaScript version)
 * Registers the custom Android APK installer plugin with Capacitor
 */

import { registerPlugin } from '@capacitor/core';

/**
 * Register the AndroidInstaller plugin
 * The plugin name must match the @CapacitorPlugin annotation in Java
 */
const AndroidInstaller = registerPlugin('AndroidInstaller', {
    web: () => {
        // Web fallback - not supported on web
        return {
            async installAPK() {
                throw new Error('AndroidInstaller is not available on web platform');
            },
            async checkInstallPermission() {
                throw new Error('AndroidInstaller is not available on web platform');
            },
            async requestInstallPermission() {
                throw new Error('AndroidInstaller is not available on web platform');
            },
        };
    },
});

export { AndroidInstaller };
