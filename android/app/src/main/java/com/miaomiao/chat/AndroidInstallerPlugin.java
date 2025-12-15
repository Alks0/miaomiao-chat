package com.miaomiao.chat;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * AndroidInstaller Plugin
 * 处理 APK 安装和权限管理
 */
@CapacitorPlugin(name = "AndroidInstaller")
public class AndroidInstallerPlugin extends Plugin {

    /**
     * 安装 APK 文件
     * @param call Capacitor 调用对象,包含 uri 参数
     */
    @PluginMethod
    public void installAPK(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("Missing uri parameter");
            return;
        }

        try {
            File file = new File(Uri.parse(uri).getPath());

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Android 7.0+ 使用 FileProvider
                Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                // Android 6.0 及以下直接使用文件 URI
                intent.setDataAndType(Uri.fromFile(file), "application/vnd.android.package-archive");
            }

            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Install failed: " + e.getMessage());
        }
    }

    /**
     * 检查是否有安装 APK 的权限 (Android 8.0+)
     * @param call Capacitor 调用对象
     */
    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        boolean canInstall = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = getContext().getPackageManager().canRequestPackageInstalls();
        }

        JSObject ret = new JSObject();
        ret.put("granted", canInstall);
        call.resolve(ret);
    }

    /**
     * 请求安装 APK 的权限 (Android 8.0+)
     * @param call Capacitor 调用对象
     */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivityForResult(intent, 1234);
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }
}
