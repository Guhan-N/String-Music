package com.simpmusic.app;

import android.content.Intent;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Background playback for String Music Simple.
 *
 * Plain ExoPlayer over MediaStore content:// URIs — no extractor, no stream
 * resolution, nothing that could ever open a socket.
 */
public class LocalPlaybackService extends MediaSessionService {

    private ExoPlayer player;
    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(AudioAttributes.DEFAULT, /* handleAudioFocus= */ true);
        player.setHandleAudioBecomingNoisy(true);
        session = new MediaSession.Builder(this, player).build();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Keep playing when the user swipes the app away, but let the service
        // die once playback has stopped.
        if (player == null || player.getMediaItemCount() == 0 || !player.getPlayWhenReady()) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.release();
            session = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
