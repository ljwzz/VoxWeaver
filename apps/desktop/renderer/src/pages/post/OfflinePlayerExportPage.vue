<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["offline-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="offline-stage" aria-label="导出离线播放页静态预览">
          <section class="offline-header" aria-label="离线章节播放器固定展示">
            <div class="offline-player"><img class="offline-artwork" src="./assets/offline-chapter-artwork.svg" width="112" height="112" alt="第 12 章抽象封面"><span class="offline-resource caption">离线可打开 · ./audio/chapter-12.wav · ./artwork/chapter-12.webp</span><h1 class="offline-chapter">第 12 章 · 雨夜来客</h1><strong class="offline-segment body-strong">播放中 · P-023 · 楼道里的脚步声</strong><img class="offline-play" src="./assets/offline-play-control.svg" width="40" height="40" alt="" aria-hidden="true"><span class="offline-pause body-strong">Ⅱ</span><strong class="offline-time body-strong">00:42.680 / 08:36.200</strong>
              <div class="segment-strip" aria-label="片段时间条固定展示"><i class="segment-block" style="left:7px;width:88px"></i><i class="segment-block" style="left:103px;width:112px"></i><i class="segment-block" style="left:223px;width:76px"></i><i class="segment-block is-current" style="left:307px;width:144px"></i><i class="segment-block" style="left:459px;width:92px"></i><i class="segment-block" style="left:559px;width:126px"></i><i class="segment-block" style="left:693px;width:84px"></i><i class="segment-block" style="left:785px;width:92px"></i></div>
            </div><span class="offline-relative caption">相对资源：./timeline/chapter-12.vtt · 浏览器直接打开 index.html</span>
          </section>
          <section class="offline-timeline" aria-label="章节时间轴固定展示"><header class="offline-panel-header"><h2 class="section-title">章节时间轴</h2><span class="caption">主/次刻度 · 点击刻度或段落节点跳转</span></header>
            <div class="offline-ruler"><i class="offline-tick is-major" style="left:23.75px"></i><i class="offline-tick" style="left:138.75px"></i><i class="offline-tick" style="left:253.75px"></i><i class="offline-tick" style="left:368.75px"></i><i class="offline-tick" style="left:483.75px"></i><i class="offline-tick is-major" style="left:598.75px"></i><i class="offline-tick" style="left:713.75px"></i><i class="offline-tick" style="left:828.75px"></i><i class="offline-tick" style="left:943.75px"></i><i class="offline-tick" style="left:1058.75px"></i><i class="offline-tick is-major" style="left:1173.75px"></i><span class="offline-time-label" style="left:23.75px">00:00</span><span class="offline-time-label" style="left:311.25px">00:30</span><span class="offline-time-label" style="left:598.75px">01:00</span><span class="offline-time-label" style="left:886.25px">01:30</span><span class="offline-time-label" style="left:1123.75px">02:00</span></div>
            <div class="paragraph-node" style="left:59px"><strong>P-018</strong><span>00:00</span></div><div class="paragraph-node" style="left:219px"><strong>P-019</strong><span>00:12</span></div><div class="paragraph-node" style="left:377px"><strong>P-020</strong><span>00:24</span></div><div class="paragraph-node" style="left:535px"><strong>P-021</strong><span>00:31</span></div><div class="paragraph-node" style="left:693px"><strong>P-022</strong><span>00:37</span></div><div class="paragraph-node is-current" style="left:851px"><strong>P-023</strong><span>00:42</span></div><div class="paragraph-node" style="left:1009px"><strong>P-024</strong><span>00:51</span></div><div class="paragraph-node" style="left:1167px"><strong>P-025</strong><span>01:03</span></div><div class="offline-ruler-playhead"><span>00:42.680</span><img src="./assets/offline-handle.svg" alt="" aria-hidden="true"></div>
          </section>
          <section class="offline-transcript" aria-label="滚动剧本文本固定展示"><header class="offline-panel-header"><h2 class="section-title">滚动剧本文本</h2><span class="caption state-accent">当前 P-023 · 00:42.680 · 任一行可点击跳转</span></header><div class="transcript-lines"><div class="transcript-line"><span>00:31</span><strong>沈砚</strong><span>“谁？” 声音从门后传来，短促而克制。</span><span></span></div><div class="transcript-line"><span>00:37</span><strong>旁白</strong><span>门外的人没有回答，只将油纸伞往廊下一收。</span><span></span></div><div class="transcript-line is-current"><span>00:42</span><strong>苏婉</strong><span>“是我。夜深了，仍要来叨扰。”</span><span class="jump">点击跳转 ↗</span></div><div class="transcript-line"><span>00:51</span><strong>旁白</strong><span>沈砚沉默片刻，侧身让开门。</span><span></span></div><div class="transcript-line"><span>01:03</span><strong>苏婉</strong><span>“多谢。” 雨水从伞沿落成一线。</span><span></span></div></div></section>
        </main>
  </PageDocument>
</template>
