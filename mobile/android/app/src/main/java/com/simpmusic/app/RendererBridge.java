package com.simpmusic.app;

/**
 * Renderer liveness flag shared by MainActivity and (in Elite) the playback
 * plugin. It lives in the main source set so the Simple edition — which
 * compiles without any streaming classes — can still track it.
 */
public final class RendererBridge {

    private static volatile boolean rendererDown = false;

    private RendererBridge() {}

    public static void setRendererDown(boolean down) {
        rendererDown = down;
    }

    public static boolean isRendererDown() {
        return rendererDown;
    }
}
