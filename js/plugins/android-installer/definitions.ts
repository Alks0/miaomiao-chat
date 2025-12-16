/**
 * AndroidInstaller Plugin Definitions
 * TypeScript interfaces for the custom Android APK installer plugin
 */

export interface AndroidInstallerPlugin {
    /**
     * Install an APK file
     * @param options - Installation options
     * @returns Promise that resolves when installation intent is launched
     */
    installAPK(options: { uri: string }): Promise<void>;

    /**
     * Check if the app has permission to install unknown apps
     * @returns Promise with permission status
     */
    checkInstallPermission(): Promise<{ granted: boolean }>;

    /**
     * Request permission to install unknown apps
     * Opens system settings for the user to grant permission
     * @returns Promise that resolves when settings are opened
     */
    requestInstallPermission(): Promise<void>;
}
