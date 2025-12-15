package com.miaomiao.chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 注册 AndroidInstaller 插件
        registerPlugin(AndroidInstallerPlugin.class);
    }
}
