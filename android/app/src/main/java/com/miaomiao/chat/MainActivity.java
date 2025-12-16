package com.miaomiao.chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册 AndroidInstaller 插件（必须在 super.onCreate() 之前）
        registerPlugin(AndroidInstallerPlugin.class);

        super.onCreate(savedInstanceState);
    }
}
