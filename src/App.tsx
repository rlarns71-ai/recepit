/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, RotateCcw, Maximize2, Users, X, BookOpen } from 'lucide-react';

/* =========================================================================
   1. TIMING CONSTANTS (명시적 분리)
   ========================================================================= */
export const TIMING = {
  // 공격 (Player Attack - 팔꿈치 및 맨몸 타격)
  ATTACK_WINDUP: 0.12,   // 선딜: 0.12초
  ATTACK_ACTIVE: 0.10,   // 판정: 0.10초
  ATTACK_RECOVERY: 0.22, // 후딜: 0.22초

  // 구르기 (Player Roll)
  ROLL_INVULN_START: 0.04, // 0.04초부터 무적 시작
  ROLL_INVULN_END: 0.26,   // 0.26초까지 무적 지속
  ROLL_DURATION: 0.36,     // 구르기 총 지속 시간
  ROLL_SPEED: 175,         // px/sec

  // 플레이어 물리
  WALK_SPEED: 85,          // px/sec
  JUMP_FORCE: -215,        // px/sec
  GRAVITY: 620,            // px/sec^2
  GROUND_Y: 144,           // 바닥 높이 (내부 180 기준)
  HIT_STAGGER: 0.30,       // 피격 경직 시간
  INVULNERABLE_TIME: 1.0,  // 피격 후 무적 시간

  // 적 "설비" (Apparatus) 5단계 공격 사이클
  ENEMY_STAGE_1_ROD: 0.75,     // 1단계: 장대 나옴 (전방으로 뻗음)
  ENEMY_STAGE_2_RING: 0.50,    // 2단계: 고리 닫힘 ('푹' 소리와 함께 닫힘 - 공격 판정)
  ENEMY_STAGE_3_RETRACT: 0.55, // 3단계: 장대 돌아감 (회수)
  ENEMY_STAGE_4_BLINK: 0.45,   // 4단계: 유리알 깜빡임 (과열 경고 깜빡임)
  ENEMY_STAGE_5_REST: 1.20,    // 5단계: 쉼 (타격 가능한 유일한 틈)
} as const;

// 60Hz 고정 타임스텝 및 해상도
const FIXED_TIMESTEP = 1 / 60;
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 180;

/* =========================================================================
   2. SOUND ENGINE (Web Audio API - 무외부 라이브러리)
   ========================================================================= */
class SoundEngine {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  private init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playStep(isCement = false) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isCement ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isCement ? 110 : 85, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(35, this.ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  }

  playJump() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(250, this.ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.12);
  }

  playRoll() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(140, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playAttackSwing() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.07, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.09);
  }

  playHitGlass() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, this.ctx.currentTime + 0.22);
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.22);
  }

  playDeflect() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(420, this.ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  playPlayerHurt() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(60, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playEnemyRingSnap() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(460, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.14);
  }

  playEnemyBlink() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.06);
  }

  playStamp() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playWedgeHammer() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, this.ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.14, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.16);
  }

  playSelect() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  playConfirm() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(130, this.ctx.currentTime + 0.22);
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.22);
  }
}

const sounds = new SoundEngine();

/* =========================================================================
   3. NOVEL CHAPTER ENUM (전체 13장)
   ========================================================================= */
export type ChapterId = 
  | 'CH1'  // 1장 비키지 않는 사람
  | 'CH2'  // 2장 칸
  | 'CH3'  // 3장 사본
  | 'CH4'  // 4장 보호소
  | 'CH5'  // 5장 뒷골목
  | 'CH6'  // 6장 부엌
  | 'CH7'  // 7장 처마
  | 'CH8'  // 8장 며칠
  | 'CH9'  // 9장 쐐기
  | 'CH10' // 10장 꼭대기
  | 'CH11' // 11장 손
  | 'CH12' // 12장 끊다
  | 'CH13';// 13장 영수증

export const CHAPTER_NAMES: Record<ChapterId, string> = {
  CH1: '1장. 비키지 않는 사람',
  CH2: '2장. 칸',
  CH3: '3장. 사본',
  CH4: '4장. 보호소',
  CH5: '5장. 뒷골목',
  CH6: '6장. 부엌',
  CH7: '7장. 처마',
  CH8: '8장. 며칠',
  CH9: '9장. 쐐기',
  CH10: '10장. 꼭대기',
  CH11: '11장. 손',
  CH12: '12장. 끊다',
  CH13: '13장. 영수증',
};

/* =========================================================================
   등장인물 에셋 및 설정 (주인공, 수레, 솥, 처마, 쐐기, 손)
   ========================================================================= */
export type CharacterId = 'main' | 'sure' | 'sot' | 'cheoma' | 'sswaegi' | 'son' | 'opponent';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  role: string;
  src: string;
  description: string;
  appearance: string;
  quotes: string[];
  chapters: string;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  main: {
    id: 'main',
    name: '주인공 (0412호)',
    role: '이탈자 / 번호판을 단 사내',
    src: '/assets/characters/main.png',
    description: '어깨 위로 늘어뜨린 긴 머리를 질끈 묶은 건장한 체격의 사내. 등 뒤에 번호판 [0412]를 달고 끝없는 노란 벽과 파란 창틀의 거리를 걷는다.',
    appearance: '넓은 어깨, 다부진 턱선, 검은 장발, 회색 작업복과 검은 바지. 맨몸과 팔꿈치로 설비의 고리를 쳐내며 전진한다.',
    quotes: ['"생각하고 있어. 멈춘 거 아니야!"', '"피도 상처도 없다. 눈을 깜빡이지 않는다."'],
    chapters: '전 장 (1장~13장)',
  },
  sure: {
    id: 'sure',
    name: '수레 (운반인)',
    role: '보호소 수레 운반인',
    src: '/assets/characters/sure.jpg',
    description: '차양에 머리가 닿을 정도로 비정상적으로 키가 큰 자. 팔꿈치가 두 번 꺾이며, 손수레의 손잡이를 쥔 손가락은 아홉 개뿐이다.',
    appearance: '키가 2m를 넘는 마르고 긴 체형, 겹겹이 접힌 흰 천을 실은 수레, 감정이 드러나지 않는 무표정한 시선.',
    quotes: ['"비켜 주시면 지나갑니다."', '"세 번째 칸(보호 신청)을 체크한 적이 있습니까?"', '"일어나지 못하면 번호가 됩니다."'],
    chapters: '1장 (비키지 않는 사람), 11장 (손), 13장 (영수증)',
  },
  sot: {
    id: 'sot',
    name: '솥 (취사인)',
    role: '뒷골목 부엌의 밥 짓는 이',
    src: '/assets/characters/sot.jpg',
    description: '다시 동여맨 머리끈, 안쪽 전완에 남아있는 화상 자국, 물과 뜨거운 김에 붉게 튼 손. 골목 안 가마솥에서 묽은 죽을 끓인다.',
    appearance: '질긴 무명 앞치마, 국자를 쥔 굳은살 박힌 손, 온화하지만 지친 눈매.',
    quotes: ['"알아. 그래도 내일 아침 밥 해야 돼."', '"죽은 묽어야 먹어. 씹지 않아도 넘어가게."', '"이불 밑에 발 넣고 가만히 있어요."'],
    chapters: '6장 (부엌), 11장 (손), 13장 (결말)',
  },
  cheoma: {
    id: 'cheoma',
    name: '처마 (서식 작성인)',
    role: '서류의 세 번째 칸을 만든 자',
    src: '/assets/characters/cheoma.jpg',
    description: '처마 밑에 서서 목을 길게 구부리던 자. 헐렁한 흰옷과 반쯤 감긴 무거운 눈꺼풀. 서류에 "보호 신청" 칸을 고안한 죄책감을 안고 산다.',
    appearance: '처마 아래 그늘진 얼굴, 구부정한 목, 길고 늘어진 손가락, 바랜 흰 두루마기.',
    quotes: ['"제 손이 닿으면 빨라져요. 그걸 두 번 배웠어요."', '"누가 이걸 만들었냐고요? 제 생각엔... 막지 않은 것들이 만든 거겠죠. 저 같은."'],
    chapters: '7장 (처마), 13장 (결말)',
  },
  sswaegi: {
    id: 'sswaegi',
    name: '쐐기 (파괴인)',
    role: '설비 몸통을 부수는 사내',
    src: '/assets/characters/sswaegi.jpg',
    description: '손때 묻어 홈이 파인 망치 자루와 허리 캔버스 주머니에 든 수많은 나무 쐐기. 광대뼈를 가로지르는 흉터와 밤을 새워도 꺼지지 않는 눈빛.',
    appearance: '거친 작업 조끼, 허리춤의 쐐기 주머니, 묵직한 쇠망치, 날카로운 눈매.',
    quotes: ['"유리알만 깨면 하루면 갈아 끼워. 몸통을 벌려야 통째로 바꿔야 돼. 사흘이야."', '"그 집 밥 오래 못 가. 이탈자 들인 번지가 책상에 올라갔어."'],
    chapters: '9장 (쐐기), 10장 (꼭대기), 13장 (결말)',
  },
  son: {
    id: 'son',
    name: '손 (관리인)',
    role: '보호소의 차가운 손',
    src: '/assets/characters/son.jpg',
    description: '창백한 보호소 황갈색 유니폼. 영구적인 푸른 잉크가 손톱 밑까지 밴 소름 끼치도록 작고 차가운 손. 나긋나긋한 미소 뒤에 서늘한 체념을 강요한다.',
    appearance: '단정한 황갈색 제복, 잉크 물든 작은 손, 끈 달린 꼬리표를 든 온화하고 차가운 표정.',
    quotes: ['"이제 쉬어도 돼요."', '"발목에 번호표를 감으면 아무도 아프지 않습니다."', '"생각을 멈추면 편안해져요."'],
    chapters: '11장 (손)',
  },
  opponent: {
    id: 'opponent',
    name: '골목의 조우',
    role: '생존을 위해 밀고하는 자',
    src: '/assets/characters/main.png',
    description: '앞니가 빠지고 헐벗은 차림의 뒷골목 주민. 한 끼 배급을 받기 위해 이탈자를 붙잡아 보호소 앞문에 넘기려 한다.',
    appearance: '남루한 옷, 굶주린 눈동자, 파란 포장지 부스러기.',
    quotes: ['"리본 달고 다니는 놈이... 놔 줘. 배고파."', '"너 하나 넘기면... 한 끼야."'],
    chapters: '5장 (뒷골목), 8장 (며칠)',
  },
};

export type DialogueItem =
  | string[]
  | {
      speaker?: CharacterId;
      speakerName?: string;
      lines: string[];
    };

type PlayerState = 'idle' | 'walk' | 'jump' | 'roll' | 'attack' | 'hit' | 'tackle';
type EnemyStage = 'stage1_rod' | 'stage2_ring' | 'stage3_retract' | 'stage4_blink' | 'stage5_rest';

/* =========================================================================
   4. MAIN COMPONENT
   ========================================================================= */
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 화면 설정
  const [isMuted, setIsMuted] = useState(false);
  const [scale, setScale] = useState<number>(3);
  const [isCodexOpen, setIsCodexOpen] = useState(false);

  // 캐릭터 이미지 사전 로딩
  const characterImagesRef = useRef<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    const list: Record<string, string> = {
      main: '/assets/characters/main.png',
      sure: '/assets/characters/sure.jpg',
      sot: '/assets/characters/sot.jpg',
      cheoma: '/assets/characters/cheoma.jpg',
      sswaegi: '/assets/characters/sswaegi.jpg',
      son: '/assets/characters/son.jpg',
    };

    Object.entries(list).forEach(([key, src]) => {
      const img = new Image();
      img.src = src;
      characterImagesRef.current[key] = img;
    });
  }, []);

  // 입력
  const keysDownRef = useRef<{ [key: string]: boolean }>({});
  const lastAdvanceTimeRef = useRef<number>(0);

  // 현재 장 & 글로벌 게임 상태
  const currentChapterRef = useRef<ChapterId>('CH1');
  const chapterTimerRef = useRef<number>(0);
  const chapterTitleTimerRef = useRef<number>(3.0);
  const numberPlateRef = useRef<'0412' | '0413'>('0412');

  // 내부 카운터 (점수/평가 없이 조용히 누적)
  const sparedCountRef = useRef<number>(0);

  // 대화 및 조우 UI 상태
  const [modalState, setModalState] = useState<{
    visible: boolean;
    type: 'DIALOGUE' | 'ENCOUNTER_CHOICE';
    speaker?: CharacterId;
    speakerName?: string;
    lines: string[];
    choice: 'spare' | 'kill';
    onConfirm?: (choice: 'spare' | 'kill') => void;
  }>({
    visible: false,
    type: 'DIALOGUE',
    speaker: 'main',
    speakerName: '주인공 (0412호)',
    lines: [],
    choice: 'spare',
  });

  // 플레이어 객체 (장발의 건장한 사내)
  const playerRef = useRef({
    x: 40,
    y: TIMING.GROUND_Y,
    vx: 0,
    vy: 0,
    facing: 1 as 1 | -1,
    state: 'idle' as PlayerState,
    stateTimer: 0,
    health: 4,
    invulnerableTimer: 0,
    isGrounded: true,
    stepTimer: 0,
    hasBandages: false,
    hasWedgeAndStone: false,
  });

  // 수레 객체
  const cartRef = useRef({
    active: false,
    x: 290,
    y: TIMING.GROUND_Y,
    speed: 25,
    state: 'APPROACH' as 'APPROACH' | 'LIFT_WOMAN' | 'MEET_PLAYER' | 'IN_DIALOGUE' | 'BYPASS' | 'DONE',
    timer: 0,
    carriedPerson: false,
  });

  // 1장 여자
  const womanRef = useRef({
    x: 180,
    y: TIMING.GROUND_Y,
    tag: '0413',
    pickedUp: false,
  });

  // 설비 객체 (3장/8장)
  const apparatusRef = useRef({
    active: false,
    x: 230,
    y: TIMING.GROUND_Y,
    facing: -1 as 1 | -1,
    hitsTaken: 0,
    hitsRequired: 3,
    stage: 'stage1_rod' as EnemyStage,
    stageTimer: 0,
    rodProgress: 0,
    ringClosed: false,
    blinkCount: 0,
    blinkVisible: true,
    isSubdued: false,
    deflectFlashTimer: 0,
    hitFlashTimer: 0,
    paperDropped: false,
  });

  // 12장 사육장 옥상 거대 설비
  const roofApparatusRef = useRef({
    active: false,
    x: 230,
    y: TIMING.GROUND_Y,
    eyesBroken: 0,
    eyesTotal: 6,
    armTimer: 0,
    armStriking: false,
    wedgeHits: 0,
    steamExploded: false,
  });

  // 뒷골목 / 거리 조우 상대
  const encounterOpponentRef = useRef({
    active: false,
    x: 220,
    y: TIMING.GROUND_Y,
    state: 'IDLE' as 'IDLE' | 'ATTACK' | 'PINNED' | 'FLED' | 'DEAD',
    resolved: false,
  });

  // 13장 영수증 결말 연출 변수
  const endingTimerRef = useRef<number>(0);
  const endingCrowdStepRef = useRef<number>(0);

  // 카메라
  const cameraXRef = useRef<number>(0);

  // 반응형 정수배 스케일 계산
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const fitScale = Math.max(1, Math.floor(Math.min(w / CANVAS_WIDTH, h / CANVAS_HEIGHT)));
      setScale(fitScale);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 키보드 핸들러
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCodexOpen(prev => !prev);
        return;
      }

      if (isCodexOpen) return;

      if (e.repeat) return; // 연타 및 키 반복으로 인한 무한 루프 원천 차단

      if (modalState.visible) {
        if (modalState.type === 'ENCOUNTER_CHOICE') {
          if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            sounds.playSelect();
            setModalState(prev => ({ ...prev, choice: 'spare' }));
            return;
          }
          if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            sounds.playSelect();
            setModalState(prev => ({ ...prev, choice: 'kill' }));
            return;
          }
        }
        if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter' || e.key === ' ') {
          const now = performance.now();
          if (now - lastAdvanceTimeRef.current < 220) return;
          lastAdvanceTimeRef.current = now;

          if (modalState.onConfirm) {
            modalState.onConfirm(modalState.choice);
          }
          return;
        }
        return;
      }

      // 13장 결말 완료 후 재시작 키
      if (currentChapterRef.current === 'CH13' && endingTimerRef.current > 5.5) {
        if (e.key === 'r' || e.key === 'R' || e.key === 'Enter') {
          restartGame();
          return;
        }
      }

      keysDownRef.current[e.key.toLowerCase()] = true;
      keysDownRef.current[e.code] = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysDownRef.current[e.key.toLowerCase()] = false;
      keysDownRef.current[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [modalState, isCodexOpen]);

  // 재시작
  const restartGame = useCallback(() => {
    currentChapterRef.current = 'CH1';
    chapterTimerRef.current = 0;
    chapterTitleTimerRef.current = 3.0;
    numberPlateRef.current = '0412';
    sparedCountRef.current = 0;
    endingTimerRef.current = 0;
    endingCrowdStepRef.current = 0;
    cameraXRef.current = 0;

    playerRef.current = {
      x: 40,
      y: TIMING.GROUND_Y,
      vx: 0,
      vy: 0,
      facing: 1,
      state: 'idle',
      stateTimer: 0,
      health: 4,
      invulnerableTimer: 0,
      isGrounded: true,
      stepTimer: 0,
      hasBandages: false,
      hasWedgeAndStone: false,
    };

    cartRef.current = {
      active: true,
      x: 310,
      y: TIMING.GROUND_Y,
      speed: 25,
      state: 'APPROACH',
      timer: 0,
      carriedPerson: false,
    };

    womanRef.current = {
      x: 180,
      y: TIMING.GROUND_Y,
      tag: '0413',
      pickedUp: false,
    };

    apparatusRef.current.active = false;
    encounterOpponentRef.current.active = false;
    roofApparatusRef.current.active = false;

    setModalState({
      visible: false,
      type: 'DIALOGUE',
      lines: [],
      choice: 'spare',
    });
  }, []);

  useEffect(() => {
    restartGame();
  }, [restartGame]);

  // 60Hz 고정 타임스텝 게임 루프
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let lastTime = performance.now();
    let accumulator = 0;
    let animationFrameId: number;

    const gameLoop = (currentTime: number) => {
      let delta = (currentTime - lastTime) / 1000;
      lastTime = currentTime;
      if (delta > 0.1) delta = 0.1;

      accumulator += delta;
      while (accumulator >= FIXED_TIMESTEP) {
        updateSimulation(FIXED_TIMESTEP);
        accumulator -= FIXED_TIMESTEP;
      }

      render(ctx);
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  /* =========================================================================
     5. SIMULATION UPDATE (전체 13장 유기적 흐름)
     ========================================================================= */
  const updateSimulation = (dt: number) => {
    chapterTimerRef.current += dt;
    if (chapterTitleTimerRef.current > 0) {
      chapterTitleTimerRef.current -= dt;
    }

    const p = playerRef.current;
    if (p.invulnerableTimer > 0) p.invulnerableTimer -= dt;

    if (modalState.visible || isCodexOpen) return; // 모달 및 인물록 활성 시 시뮬레이션 일시 정지

    switch (currentChapterRef.current) {
      case 'CH1':
        updateChapter1(dt);
        break;
      case 'CH2':
        updateChapter2(dt);
        break;
      case 'CH3':
        updateChapter3(dt);
        break;
      case 'CH4':
        // 전환 컷씬 모달 진행
        break;
      case 'CH5':
        updateChapter5(dt);
        break;
      case 'CH6':
        updateChapter6(dt);
        break;
      case 'CH7':
        updateChapter7(dt);
        break;
      case 'CH8':
        updateChapter8(dt);
        break;
      case 'CH9':
        updateChapter9(dt);
        break;
      case 'CH10':
        updateChapter10(dt);
        break;
      case 'CH11':
        updateChapter11(dt);
        break;
      case 'CH12':
        updateChapter12(dt);
        break;
      case 'CH13':
        updateChapter13(dt);
        break;
    }
  };

  /* -------------------------------------------------------------------------
     장별 세부 로직 (자연스러운 1~13장 전이)
     ------------------------------------------------------------------------- */
  // 1장: 비키지 않는 사람
  const updateChapter1 = (dt: number) => {
    const p = playerRef.current;
    const cart = cartRef.current;
    const woman = womanRef.current;

    updatePlayerPhysics(dt, 0, 480);

    if (cart.state === 'APPROACH') {
      cart.x -= cart.speed * dt;
      if (cart.x <= woman.x + 18) {
        cart.state = 'LIFT_WOMAN';
        cart.timer = 0;
      }
    } else if (cart.state === 'LIFT_WOMAN') {
      cart.timer += dt;
      if (cart.timer > 1.2 && !woman.pickedUp) {
        woman.pickedUp = true;
        cart.carriedPerson = true;
        numberPlateRef.current = '0413';
        sounds.playStamp();
      }
      if (cart.timer > 2.2) {
        cart.state = 'MEET_PLAYER';
      }
    } else if (cart.state === 'MEET_PLAYER') {
      if (cart.x > p.x + 24) {
        cart.x -= cart.speed * dt;
      } else {
        cart.speed = 0;
        cart.state = 'IN_DIALOGUE';
        showSequentialDialogues([
          { speaker: 'sure', lines: ["손수레가 코앞에서 멈췄다.", "바퀴가 한 번 덜컹하고 섰다."] },
          { speaker: 'main', lines: ["\"아직 안 죽었는데.\" 내가 말했다.", "\"그렇지.\" 그가 짧게 답했다."] },
          { speaker: 'sure', lines: ["\"그런데 왜 실어.\"", "\"표가 붙어 있네.\" 그가 수레를 짚었다."] },
          { speaker: 'sure', lines: ["\"누가 붙였어.\"", "\"내가 붙이는 게 아닐세. 세 번째 칸(보호 신청)이 채워진 게지.\""] },
          { speaker: 'main', lines: ["내 두 손은 비어 있었다.", "나는 비키지 않았다."] },
          { speaker: 'sure', lines: ["수레가 처음으로 나를 제대로 보았다.", "아홉 개의 손가락으로 손잡이를 고쳐 잡고, 옆으로 돌아 지나갔다."] }
        ], () => {
          cartRef.current.state = 'BYPASS';
        });
      }
    } else if (cart.state === 'BYPASS') {
      cart.x -= 30 * dt;
      if (cart.x < -40) {
        cart.state = 'DONE';
        transitionToChapter('CH2');
      }
    }

    followCamera(p.x, 0, 180);
  };

  // 2장: 칸
  const updateChapter2 = (dt: number) => {
    const p = playerRef.current;
    updatePlayerPhysics(dt, 0, 400);

    // 2장 이벤트: 창구와 설비의 등장
    if (chapterTimerRef.current > 1.2 && !apparatusRef.current.active) {
      apparatusRef.current.active = true;
      apparatusRef.current.x = 240;

      showSequentialDialogues([
        { speaker: 'main', lines: ["저녁이 되자 파란 차양 아래로 파란 셔터가 내려왔다.", "벽에 파란 신고함이 붙어 있었다. [보신 것이 있으면 넣어 주세요.]"] },
        { speaker: 'cheoma', lines: ["아침에 창구에서 온 키 큰 자가 왔다. 서류판과 자를 들고 있었다.", "\"칸이 없네... 나간 거, 겠지요. 네. 이탈.\""] },
        { speaker: 'cheoma', lines: ["자를 대고 또박또박 쓴 네모 안에 [이탈]을 적고 도장을 찍었다.", "그리고 바퀴 달린 푸른 설비의 몸통 옆 홈에 접힌 종이를 끼웠다."] }
      ], () => {
        transitionToChapter('CH3');
      });
    }

    followCamera(p.x, 0, 180);
  };

  // 3장: 사본 (설비 전투)
  const updateChapter3 = (dt: number) => {
    const p = playerRef.current;
    const app = apparatusRef.current;

    updatePlayerPhysics(dt, 20, 320);
    followCamera(40, 0, 180);

    if (!app.active || app.isSubdued) return;
    if (app.deflectFlashTimer > 0) app.deflectFlashTimer -= dt;
    if (app.hitFlashTimer > 0) app.hitFlashTimer -= dt;

    // 설비 5단계 사이클
    app.stageTimer += dt;
    switch (app.stage) {
      case 'stage1_rod':
        app.rodProgress = Math.min(1, app.stageTimer / TIMING.ENEMY_STAGE_1_ROD);
        app.ringClosed = false;
        if (app.stageTimer >= TIMING.ENEMY_STAGE_1_ROD) {
          app.stage = 'stage2_ring';
          app.stageTimer = 0;
          app.rodProgress = 1;
        }
        break;
      case 'stage2_ring':
        app.rodProgress = 1;
        if (!app.ringClosed && app.stageTimer > 0.08) {
          app.ringClosed = true;
          sounds.playEnemyRingSnap();
          checkApparatusHit();
        }
        if (app.stageTimer >= TIMING.ENEMY_STAGE_2_RING) {
          app.stage = 'stage3_retract';
          app.stageTimer = 0;
        }
        break;
      case 'stage3_retract':
        app.rodProgress = Math.max(0, 1 - (app.stageTimer / TIMING.ENEMY_STAGE_3_RETRACT));
        app.ringClosed = false;
        if (app.stageTimer >= TIMING.ENEMY_STAGE_3_RETRACT) {
          app.stage = 'stage4_blink';
          app.stageTimer = 0;
          app.rodProgress = 0;
          app.blinkCount = 0;
        }
        break;
      case 'stage4_blink': {
        const b = Math.floor(app.stageTimer / 0.11);
        if (b !== app.blinkCount) {
          app.blinkCount = b;
          app.blinkVisible = !app.blinkVisible;
          if (app.blinkVisible) sounds.playEnemyBlink();
        }
        if (app.stageTimer >= TIMING.ENEMY_STAGE_4_BLINK) {
          app.stage = 'stage5_rest';
          app.stageTimer = 0;
          app.blinkVisible = true;
        }
        break;
      }
      case 'stage5_rest':
        app.rodProgress = 0;
        app.ringClosed = false;
        if (app.stageTimer >= TIMING.ENEMY_STAGE_5_REST) {
          app.stage = 'stage1_rod';
          app.stageTimer = 0;
        }
        break;
    }
  };

  const checkApparatusHit = () => {
    const p = playerRef.current;
    const app = apparatusRef.current;
    if (p.state === 'roll' && p.stateTimer >= TIMING.ROLL_INVULN_START && p.stateTimer <= TIMING.ROLL_INVULN_END) return;
    if (p.invulnerableTimer > 0) return;

    const ringX = app.x + app.facing * 54;
    if (Math.abs(ringX - p.x) < 14) {
      p.health -= 1;
      p.state = 'hit';
      p.stateTimer = 0;
      p.invulnerableTimer = TIMING.INVULNERABLE_TIME;
      p.vx = -60;
      sounds.playPlayerHurt();
      if (p.health <= 0) {
        p.health = 4;
        p.x = 60;
        app.hitsTaken = 0;
        app.stage = 'stage1_rod';
      }
    }
  };

  const checkAttackApparatus = () => {
    const p = playerRef.current;
    const app = apparatusRef.current;
    if (!app.active || app.isSubdued) return;

    const reachX = p.x + p.facing * 24;
    if (Math.abs(reachX - app.x) < 22) {
      if (app.stage === 'stage5_rest') {
        if (app.hitFlashTimer <= 0) {
          app.hitsTaken += 1;
          app.hitFlashTimer = 0.25;
          sounds.playHitGlass();
          if (app.hitsTaken >= app.hitsRequired && !app.isSubdued) {
            app.isSubdued = true;
            app.paperDropped = true;
            setTimeout(() => {
              showSequentialDialogues([
                ["유리알이 안으로 무너졌다.", "몸통이 한쪽으로 기울었다."],
                ["옆 홈에 끼워져 있던 접힌 종이가 배수구 덮개 위로 떨어졌다.", "손으로 그린 네모 안의 두 글자 [이탈]에 물이 스몄다."]
              ], () => {
                transitionToChapter('CH4');
              });
            }, 500);
          }
        }
      } else {
        if (app.deflectFlashTimer <= 0) {
          app.deflectFlashTimer = 0.15;
          sounds.playDeflect();
        }
      }
    }
  };

  // 4장: 보호소
  const startChapter4Cutscene = () => {
    playerRef.current.hasBandages = true;
    showSequentialDialogues([
      { speaker: 'main', lines: ["비누 냄새가 먼저 왔다. 천장은 흰색 타일, 줄눈까지 닦여 있었다.", "손을 들어 보았다. 두 손 마디마다 파란 붕대가 감겨 있었다."] },
      { speaker: 'son', lines: ["접수대의 서류: [보호 접수 - 이탈 - 처리번호 없음].", "빨간 도장 쾅. [보류]. \"오늘은 그냥 가셔도 돼요.\""] },
      { speaker: 'main', lines: ["쟁반을 미는 것이 파란 뒷문을 열어 주었다.", "\"다음엔 다치지 말고 와요.\" 빗장이 탁, 탁 잠겼다."] }
    ], () => {
      transitionToChapter('CH5');
    });
  };

  // 5장: 뒷골목
  const updateChapter5 = (dt: number) => {
    const p = playerRef.current;
    const opp = encounterOpponentRef.current;

    updatePlayerPhysics(dt, 20, 500);
    followCamera(p.x, 0, 240);

    if (opp.active && !opp.resolved && Math.abs(p.x - opp.x) < 28 && opp.state === 'IDLE') {
      opp.state = 'ATTACK';
      p.state = 'tackle';
      p.vx = 0;
      sounds.playEnemyRingSnap();

      setTimeout(() => {
        showEncounterChoice([
          "무릎으로 상대의 가슴을 눌렀다. 앞니 하나가 없었다.",
          "\"리본 달고 다니는 놈이... 놔 줘. 배고파.\"",
          "\"그쪽 앞문에 데려가면... 너 하나면 한 끼야.\""
        ], (choice) => {
          opp.resolved = true;
          if (choice === 'spare') {
            sparedCountRef.current += 1;
            opp.state = 'FLED';
          } else {
            opp.state = 'DEAD';
          }
          p.state = 'idle';
        });
      }, 400);
    }

    if (opp.state === 'FLED') opp.x += 60 * dt;

    if (opp.resolved && p.x > 380) {
      transitionToChapter('CH6');
    }
  };

  // 6장: 부엌
  const updateChapter6 = (dt: number) => {
    const p = playerRef.current;
    updatePlayerPhysics(dt, 20, 340);
    followCamera(p.x, 0, 160);

    if (chapterTimerRef.current > 1.0 && !encounterOpponentRef.current.resolved) {
      encounterOpponentRef.current.resolved = true;
      showSequentialDialogues([
        { speaker: 'sot', lines: ["문 안쪽은 부엌이었다. 가마솥에서 김이 올랐다.", "솥 앞의 사람이 따뜻한 물로 손목의 모래를 씻어 내고 마른 천을 둘러 주었다."] },
        { speaker: 'sot', lines: ["\"알아? 저기서 뭘 하는지... 번호 붙여서 실어 가는 거.\" 내가 말했다.", "\"알아. 그래도 내일 아침 밥 해야 돼.\" 그 사람은 함지에 쌀을 안쳤다."] },
        { speaker: 'sot', lines: ["밤중에 늦은 조회가 문을 두드렸다. 그 사람은 이불 밖으로 나온 손을 꼭 쥐며 나를 숨겨 주었다.", "아침에 씹지 않아도 되는 묽은 죽이 사발에 담겨 나왔다."] }
      ], () => {
        transitionToChapter('CH7');
      });
    }
  };

  // 7장: 처마
  const updateChapter7 = (dt: number) => {
    const p = playerRef.current;
    updatePlayerPhysics(dt, 20, 320);

    if (chapterTimerRef.current > 0.8 && !encounterOpponentRef.current.resolved) {
      encounterOpponentRef.current.resolved = true;
      showSequentialDialogues([
        { speaker: 'cheoma', lines: ["나흘째 밤, 처마 밑에 서던 키 큰 자가 문지방에 앉았다.", "\"제가 서류에 세 번째 칸(보호 신청)을 만들었더니... 보호소가 두 배로 늘고 수레가 바빠졌어요.\""] },
        { speaker: 'cheoma', lines: ["\"제 손이 닿으면 빨라져요. 그걸 두 번 배웠어요.\"", "\"누가 이걸 만들었냐고요? 제 생각엔... 막지 않은 것들이 만든 거겠죠. 저 같은.\""] },
        { speaker: 'main', lines: ["나는 조용히 뒷문 빗장을 들어 올렸다.", "어두운 골목 끝에 푸른 설비가 밤새 길을 지키고 서 있었다."] }
      ], () => {
        transitionToChapter('CH8');
      });
    }
  };

  // 8장: 며칠
  const updateChapter8 = (dt: number) => {
    const p = playerRef.current;
    const opp = encounterOpponentRef.current;

    updatePlayerPhysics(dt, 20, 520);
    followCamera(p.x, 0, 240);

    if (opp.active && !opp.resolved && Math.abs(p.x - opp.x) < 28 && opp.state === 'IDLE') {
      opp.state = 'ATTACK';
      p.state = 'tackle';
      p.vx = 0;
      sounds.playEnemyRingSnap();

      setTimeout(() => {
        showEncounterChoice([
          "벽에 기대 졸고 있는 이를 끌고 가려던 자를 쓰러뜨렸다. 주머니에서 파란 포장지가 굴러 나왔다.",
          "\"…한 끼. 한 끼만.\"",
          "\"어차피 실려 가잖아. 실려 가는 거 나도 알아.\""
        ], (choice) => {
          opp.resolved = true;
          if (choice === 'spare') {
            sparedCountRef.current += 1;
            opp.state = 'FLED';
          } else {
            opp.state = 'DEAD';
          }
          p.state = 'idle';
        });
      }, 400);
    }

    if (opp.state === 'FLED') opp.x += 60 * dt;

    if (opp.resolved && p.x > 380) {
      transitionToChapter('CH9');
    }
  };

  // 9장: 쐐기
  const updateChapter9 = (dt: number) => {
    const p = playerRef.current;
    updatePlayerPhysics(dt, 20, 400);
    followCamera(p.x, 0, 200);

    if (chapterTimerRef.current > 0.8 && !encounterOpponentRef.current.resolved) {
      encounterOpponentRef.current.resolved = true;
      showSequentialDialogues([
        { speaker: 'sswaegi', lines: ["골목 모퉁이에 몸통이 벌어진 채 쓰러진 설비들이 늘어 있었다.", "망치를 든 사내가 나무 쐐기를 매만지며 말했다."] },
        { speaker: 'sswaegi', lines: ["\"유리알만 깨면 하루면 갈아 끼워. 몸통을 벌려야 통째로 바꿔야 돼. 사흘이야.\"", "\"그 집 밥 오래 못 가. 이탈자 들인 집 번지가 손의 책상에 올라갔어.\""] },
        { speaker: 'main', lines: ["숫자판 밑에 쐐기 하나를 박아 두었다. 나는 위로 올라가기 시작했다."] }
      ], () => {
        transitionToChapter('CH10');
      });
    }
  };

  // 10장: 꼭대기
  const updateChapter10 = (dt: number) => {
    const p = playerRef.current;
    updatePlayerPhysics(dt, 20, 420);
    followCamera(p.x, 0, 200);

    if (chapterTimerRef.current > 0.8 && !encounterOpponentRef.current.resolved) {
      encounterOpponentRef.current.resolved = true;
      showSequentialDialogues([
        { speaker: 'sswaegi', lines: ["건물 바깥 계단을 올라 일곱째 계단참에 다다랐다.", "나와 키가 같은 자가 계단을 비켜서며 말했다. \"올라가 보세요.\""] },
        { speaker: 'sswaegi', lines: ["방 한가운데 거대한 펌프 쇠팔이 위아래로 움직였다. 쉬익, 툭.", "망치를 든 사내가 쐐기를 박아 쇠팔을 부러뜨렸다."] },
        { speaker: 'sswaegi', lines: ["그러나 먼 곳에서 다른 소리가 들려왔다. 쉬익, 툭.", "\"손이 그 여자 죽이러 간다. 오늘 해 떨어지기 전에!\" 나는 계단을 뛰어 내려갔다."] }
      ], () => {
        transitionToChapter('CH11');
      });
    }
  };

  // 11장: 손
  const updateChapter11 = (dt: number) => {
    const p = playerRef.current;
    updatePlayerPhysics(dt, 20, 440);
    followCamera(p.x, 0, 200);

    if (chapterTimerRef.current > 0.8 && !encounterOpponentRef.current.resolved) {
      encounterOpponentRef.current.resolved = true;
      showSequentialDialogues([
        { speaker: 'sot', lines: ["부엌으로 달렸으나 비어 있었다. 선반 위에 머리끈만 개켜져 있었다.", "보호소 앞문으로 뛰어 들어갔다. 칸 [솥] 안에 그 사람이 앉아 있었다."] },
        { speaker: 'son', lines: ["보호소의 작은 손을 쥔 자가 그 사람의 머리를 쓸고 있었다. \"이제 쉬어도 돼요.\"", "내가 손목을 꺾어 쥐었다. \"생각하고 있어. 멈춘 거 아니야!\""] },
        { speaker: 'sure', lines: ["그 사람이 스스로 발을 내밀어 꼬리표를 감았다.", "수레가 와서 천 위에 싣고 나갔다. 나는 따라가지 못했다."] }
      ], () => {
        transitionToChapter('CH12');
      });
    }
  };

  // 12장: 끊다 (사육장 옥상 결전)
  const updateChapter12 = (dt: number) => {
    const p = playerRef.current;
    const roof = roofApparatusRef.current;

    updatePlayerPhysics(dt, 20, 320);
    followCamera(40, 0, 180);

    if (!roof.active) {
      roof.active = true;
      p.hasWedgeAndStone = true;
    }

    roof.armTimer += dt;
    if (roof.armTimer > 1.4) {
      roof.armTimer = 0;
      sounds.playEnemyRingSnap();
      if (Math.abs(p.x - roof.x) < 32 && p.state !== 'roll') {
        p.state = 'hit';
        p.stateTimer = 0;
        p.invulnerableTimer = 0.8;
        sounds.playPlayerHurt();
      }
    }
  };

  const checkAttackRoofApparatus = () => {
    const p = playerRef.current;
    const roof = roofApparatusRef.current;
    if (!roof.active || roof.steamExploded) return;

    if (Math.abs(p.x - roof.x) < 34) {
      if (roof.eyesBroken < roof.eyesTotal) {
        roof.eyesBroken += 1;
        sounds.playHitGlass();
      } else {
        // 6개 눈 파괴 후 쐐기 타격
        roof.wedgeHits += 1;
        sounds.playWedgeHammer();
        if (roof.wedgeHits >= 3) {
          roof.steamExploded = true;
          showSequentialDialogues([
            ["시멘트 덩어리로 마지막 쐐기를 쳤다. 쇠날개가 멈췄다.", "판이 터지며 하얀 김이 한꺼번에 뿜어져 나왔다."],
            ["몸이 지붕 가장자리를 넘어 허공으로 날아갔다.", "처음 거리였다. 내 몸이 보도 블록에 닿았다. 흰색."]
          ], () => {
            transitionToChapter('CH13');
          });
        }
      }
    }
  };

  // 13장: 영수증
  const updateChapter13 = (dt: number) => {
    endingTimerRef.current += dt;
    const cart = cartRef.current;
    const p = playerRef.current;

    p.vx = 0; // 보도 블록 위에 회색으로 누움

    if (cart.x > p.x + 40) {
      cart.x -= cart.speed * dt;
    } else {
      cart.speed = 0;
      if (sparedCountRef.current >= 1) {
        if (endingCrowdStepRef.current < 1) {
          endingCrowdStepRef.current = Math.min(1, endingCrowdStepRef.current + dt * 0.35);
        }
      }
    }
  };

  /* -------------------------------------------------------------------------
     장 전이 헬퍼
     ------------------------------------------------------------------------- */
  const transitionToChapter = (nextCh: ChapterId) => {
    currentChapterRef.current = nextCh;
    chapterTimerRef.current = 0;
    chapterTitleTimerRef.current = 3.2;

    const p = playerRef.current;
    p.state = 'idle';
    p.vx = 0;
    p.vy = 0;

    // 장별 배치 리셋
    if (nextCh === 'CH3') {
      apparatusRef.current.active = true;
      apparatusRef.current.x = 230;
      apparatusRef.current.hitsTaken = 0;
      apparatusRef.current.isSubdued = false;
      p.x = 60;
    } else if (nextCh === 'CH4') {
      startChapter4Cutscene();
    } else if (nextCh === 'CH5' || nextCh === 'CH8') {
      encounterOpponentRef.current = {
        active: true,
        x: 210,
        y: TIMING.GROUND_Y,
        state: 'IDLE',
        resolved: false,
      };
      p.x = 40;
    } else if (nextCh === 'CH6' || nextCh === 'CH7' || nextCh === 'CH9' || nextCh === 'CH10' || nextCh === 'CH11') {
      encounterOpponentRef.current.resolved = false;
      p.x = 40;
    } else if (nextCh === 'CH12') {
      p.x = 50;
      roofApparatusRef.current = {
        active: true,
        x: 230,
        y: TIMING.GROUND_Y,
        eyesBroken: 0,
        eyesTotal: 6,
        armTimer: 0,
        armStriking: false,
        wedgeHits: 0,
        steamExploded: false,
      };
    } else if (nextCh === 'CH13') {
      p.x = 110;
      endingTimerRef.current = 0;
      endingCrowdStepRef.current = 0;
      cartRef.current = {
        active: true,
        x: 290,
        y: TIMING.GROUND_Y,
        speed: 18,
        state: 'APPROACH',
        timer: 0,
        carriedPerson: true,
      };
    }
  };

  /* -------------------------------------------------------------------------
     대화/선택창 헬퍼
     ------------------------------------------------------------------------- */
  const showSequentialDialogues = (dialogueList: DialogueItem[], onComplete: () => void, step = 0) => {
    if (step >= dialogueList.length) {
      setModalState(prev => ({ ...prev, visible: false }));
      onComplete();
      return;
    }

    const currentItem = dialogueList[step];
    let speaker: CharacterId = 'main';
    let speakerName = '주인공 (0412호)';
    let lines: string[] = [];

    if (Array.isArray(currentItem)) {
      lines = currentItem;
    } else {
      lines = currentItem.lines;
      if (currentItem.speaker) {
        speaker = currentItem.speaker;
        speakerName = currentItem.speakerName || CHARACTERS[currentItem.speaker]?.name || '';
      }
    }

    setModalState({
      visible: true,
      type: 'DIALOGUE',
      speaker,
      speakerName,
      lines,
      choice: 'spare',
      onConfirm: () => {
        sounds.playConfirm();
        showSequentialDialogues(dialogueList, onComplete, step + 1);
      }
    });
  };

  const showEncounterChoice = (
    lines: string[],
    onChoice: (choice: 'spare' | 'kill') => void,
    speaker: CharacterId = 'opponent'
  ) => {
    setModalState({
      visible: true,
      type: 'ENCOUNTER_CHOICE',
      speaker,
      speakerName: CHARACTERS[speaker]?.name || '골목의 조우',
      lines,
      choice: 'spare',
      onConfirm: (c) => {
        sounds.playConfirm();
        setModalState(prev => ({ ...prev, visible: false }));
        onChoice(c);
      }
    });
  };

  /* -------------------------------------------------------------------------
     플레이어 공통 물리 및 조작
     ------------------------------------------------------------------------- */
  const updatePlayerPhysics = (dt: number, minX: number, maxX: number) => {
    const p = playerRef.current;
    const keys = keysDownRef.current;
    p.stateTimer += dt;

    const isLeft = keys['arrowleft'] || keys['keya'] || keys['a'];
    const isRight = keys['arrowright'] || keys['keyd'] || keys['d'];
    const isJump = keys[' '] || keys['space'] || keys['arrowup'] || keys['keyw'];
    const isAttack = keys['z'] || keys['keyz'];
    const isRoll = keys['x'] || keys['keyx'];

    switch (p.state) {
      case 'idle':
      case 'walk':
        if (isAttack) {
          p.state = 'attack';
          p.stateTimer = 0;
          p.vx = 0;
          sounds.playAttackSwing();
          break;
        }
        if (isRoll) {
          p.state = 'roll';
          p.stateTimer = 0;
          p.vx = p.facing * TIMING.ROLL_SPEED;
          sounds.playRoll();
          break;
        }
        if (isJump && p.isGrounded) {
          p.vy = TIMING.JUMP_FORCE;
          p.isGrounded = false;
          p.state = 'jump';
          p.stateTimer = 0;
          sounds.playJump();
          break;
        }

        if (isLeft && !isRight) {
          p.vx = -TIMING.WALK_SPEED;
          p.facing = -1;
          p.state = 'walk';
          p.stepTimer += dt;
          if (p.stepTimer > 0.3) {
            p.stepTimer = 0;
            sounds.playStep(currentChapterRef.current === 'CH5' || currentChapterRef.current === 'CH6');
          }
        } else if (isRight && !isLeft) {
          p.vx = TIMING.WALK_SPEED;
          p.facing = 1;
          p.state = 'walk';
          p.stepTimer += dt;
          if (p.stepTimer > 0.3) {
            p.stepTimer = 0;
            sounds.playStep(currentChapterRef.current === 'CH5' || currentChapterRef.current === 'CH6');
          }
        } else {
          p.vx = 0;
          p.state = 'idle';
          p.stepTimer = 0;
        }
        break;

      case 'jump':
        if (isAttack) {
          p.state = 'attack';
          p.stateTimer = 0;
          sounds.playAttackSwing();
          break;
        }
        if (isLeft && !isRight) p.vx = -TIMING.WALK_SPEED * 0.85;
        else if (isRight && !isLeft) p.vx = TIMING.WALK_SPEED * 0.85;
        else p.vx *= 0.9;

        if (p.isGrounded) {
          p.state = 'idle';
          p.stateTimer = 0;
        }
        break;

      case 'roll':
        p.vx = p.facing * TIMING.ROLL_SPEED;
        if (p.stateTimer >= TIMING.ROLL_DURATION) {
          p.state = p.isGrounded ? 'idle' : 'jump';
          p.stateTimer = 0;
        }
        break;

      case 'attack': {
        const total = TIMING.ATTACK_WINDUP + TIMING.ATTACK_ACTIVE + TIMING.ATTACK_RECOVERY;
        p.vx *= 0.7;
        if (p.stateTimer >= TIMING.ATTACK_WINDUP && p.stateTimer <= TIMING.ATTACK_WINDUP + TIMING.ATTACK_ACTIVE) {
          if (currentChapterRef.current === 'CH3') checkAttackApparatus();
          if (currentChapterRef.current === 'CH12') checkAttackRoofApparatus();
        }
        if (p.stateTimer >= total) {
          p.state = p.isGrounded ? 'idle' : 'jump';
          p.stateTimer = 0;
        }
        break;
      }

      case 'hit':
        if (p.stateTimer >= TIMING.HIT_STAGGER) {
          p.state = p.isGrounded ? 'idle' : 'jump';
          p.stateTimer = 0;
        }
        break;

      case 'tackle':
        p.vx = 0;
        break;
    }

    p.vy += TIMING.GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.y >= TIMING.GROUND_Y) {
      p.y = TIMING.GROUND_Y;
      p.vy = 0;
      p.isGrounded = true;
    } else {
      p.isGrounded = false;
    }

    if (p.x < minX) p.x = minX;
    if (p.x > maxX) p.x = maxX;
  };

  const followCamera = (targetX: number, minCam: number, maxCam: number) => {
    const target = targetX - CANVAS_WIDTH * 0.35;
    cameraXRef.current += (target - cameraXRef.current) * 0.12;
    if (cameraXRef.current < minCam) cameraXRef.current = minCam;
    if (cameraXRef.current > maxCam) cameraXRef.current = maxCam;
  };

  /* =========================================================================
     6. RENDERING
     ========================================================================= */
  const render = (ctx: CanvasRenderingContext2D) => {
    ctx.imageSmoothingEnabled = false;
    const camX = Math.round(cameraXRef.current);

    // 환경별 배경
    const isAlleyOrKitchen = currentChapterRef.current === 'CH5' || currentChapterRef.current === 'CH6' || currentChapterRef.current === 'CH7';
    const isStairsOrRoof = currentChapterRef.current === 'CH10' || currentChapterRef.current === 'CH12';

    if (isAlleyOrKitchen) {
      renderAlleyBackground(ctx, camX);
    } else if (isStairsOrRoof) {
      renderRoofBackground(ctx, camX);
    } else {
      renderStreetBackground(ctx, camX);
    }

    // 바닥
    if (isAlleyOrKitchen || isStairsOrRoof) {
      renderCementFloor(ctx);
    } else {
      renderStreetFloor(ctx, camX);
    }

    // 소품 및 개체
    if (currentChapterRef.current === 'CH1' && !womanRef.current.pickedUp) {
      renderWoman(ctx, camX);
    }
    if ((currentChapterRef.current === 'CH1' || currentChapterRef.current === 'CH13') && cartRef.current.active) {
      renderCart(ctx, camX);
    }
    if (currentChapterRef.current === 'CH3' && apparatusRef.current.active) {
      renderApparatus(ctx, camX);
    }
    if (roofApparatusRef.current.active && currentChapterRef.current === 'CH12') {
      renderRoofApparatus(ctx, camX);
    }
    if (encounterOpponentRef.current.active) {
      renderOpponent(ctx, camX);
    }
    if (currentChapterRef.current === 'CH6') {
      renderSotInKitchen(ctx, camX);
    }
    if (currentChapterRef.current === 'CH7') {
      renderCheomaUnderEaves(ctx, camX);
    }
    if (currentChapterRef.current === 'CH9' || currentChapterRef.current === 'CH10') {
      renderSswaegiSaboteur(ctx, camX);
    }
    if (currentChapterRef.current === 'CH11') {
      renderShelterCell(ctx, camX);
    }
    if (currentChapterRef.current === 'CH13' && sparedCountRef.current >= 1) {
      renderChapter13Crowd(ctx, camX);
    }

    // 장발의 건장한 남성 주인공
    renderMalePlayer(ctx, camX);

    // 결말 B 암전
    if (currentChapterRef.current === 'CH13' && sparedCountRef.current === 0) {
      const alpha = Math.min(1, Math.max(0, (endingTimerRef.current - 2.0) * 0.3));
      ctx.fillStyle = `rgba(11, 13, 16, ${alpha})`;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // 상단 챕터 타이틀
    renderChapterHeader(ctx);
  };

  /* -------------------------------------------------------------------------
     배경 드로잉 함수군
     ------------------------------------------------------------------------- */
  // 거리 배경 (1장, 2장, 3장, 8장, 9장, 11장, 13장)
  const renderStreetBackground = (ctx: CanvasRenderingContext2D, camX: number) => {
    // 겹 0: 맨 뒤 (주기 97px, 속도 0.2)
    const p0 = 97;
    const off0 = (camX * 0.2) % p0;
    ctx.fillStyle = '#6e5f30';
    ctx.fillRect(0, 0, CANVAS_WIDTH, TIMING.GROUND_Y);

    for (let x = -off0; x < CANVAS_WIDTH + p0; x += p0) {
      const rx = Math.round(x);
      ctx.fillStyle = '#e2e6eb';
      ctx.fillRect(rx, 10, p0 - 2, 25);
      ctx.fillStyle = '#7a6b36';
      ctx.fillRect(rx, 35, p0 - 2, TIMING.GROUND_Y - 35);
      // 창문들
      for (let wy = 20; wy < TIMING.GROUND_Y - 20; wy += 26) {
        for (let wx = 12; wx < p0 - 18; wx += 22) {
          ctx.fillStyle = '#1c3452';
          ctx.fillRect(rx + wx, wy, 14, 18);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(rx + wx + 2, wy + 2, 10, 14);
        }
      }
    }

    // 겹 2: 전면 건물 (주기 73px, 속도 0.7) - 차양과 화분
    const p2 = 73;
    const off2 = (camX * 0.7) % p2;
    for (let x = -off2; x < CANVAS_WIDTH + p2; x += p2) {
      const rx = Math.round(x);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(rx, 42, p2 - 4, 18);
      ctx.fillStyle = '#b09d52';
      ctx.fillRect(rx, 60, p2 - 4, TIMING.GROUND_Y - 60);

      // 1층 파란 차양
      ctx.fillStyle = '#1c4270';
      ctx.fillRect(rx - 2, 104, p2, 8);

      // 창틀 화분
      for (let wy = 52; wy < 95; wy += 26) {
        for (let wx = 8; wx < p2 - 14; wx += 18) {
          ctx.fillStyle = '#224670';
          ctx.fillRect(rx + wx, wy, 10, 14);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(rx + wx + 2, wy + 2, 6, 10);
          ctx.fillStyle = '#8b5a2b';
          ctx.fillRect(rx + wx + 1, wy + 13, 8, 3);
          ctx.fillStyle = '#48bb78';
          ctx.fillRect(rx + wx + 2, wy + 11, 6, 2);
        }
      }

      // 벽에 붙어 눈을 돌리는 사람들
      ctx.fillStyle = '#8a793c';
      ctx.fillRect(rx + 54, TIMING.GROUND_Y - 26, 5, 14);
      ctx.fillRect(rx + 55, TIMING.GROUND_Y - 31, 3, 4);
    }

    // 숫자판: 흰 바탕에 파란 테두리 [오늘 처리]
    const plateScrX = Math.round(110 - camX * 0.7);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(plateScrX, 86, 28, 14);
    ctx.strokeStyle = '#1c4270';
    ctx.lineWidth = 1;
    ctx.strokeRect(plateScrX + 0.5, 86.5, 27, 13);
    ctx.fillStyle = '#1c4270';
    ctx.font = '5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('오늘 처리', plateScrX + 14, 91);
    ctx.font = 'bold 6px monospace';
    ctx.fillText(numberPlateRef.current, plateScrX + 14, 97);
  };

  // 뒷골목 / 부엌 배경 (5장, 6장, 7장)
  const renderAlleyBackground = (ctx: CanvasRenderingContext2D, camX: number) => {
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(0, 0, CANVAS_WIDTH, TIMING.GROUND_Y);

    const p = 80;
    const off = (camX * 0.6) % p;
    for (let x = -off; x < CANVAS_WIDTH + p; x += p) {
      const rx = Math.round(x);
      ctx.fillStyle = '#545b66';
      ctx.fillRect(rx, 40, p - 2, TIMING.GROUND_Y - 40);

      // 파란 뒷문
      ctx.fillStyle = '#1c4270';
      ctx.fillRect(rx + 25, 78, 24, TIMING.GROUND_Y - 78);
      ctx.fillStyle = '#143357';
      ctx.fillRect(rx + 27, 80, 20, TIMING.GROUND_Y - 80);

      if (currentChapterRef.current === 'CH6') {
        // 부엌 가마솥 김
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillRect(rx + 33, 65, 8, 10);
      }
    }
  };

  // 옥상 / 꼭대기 배경 (10장, 12장)
  const renderRoofBackground = (ctx: CanvasRenderingContext2D, camX: number) => {
    ctx.fillStyle = '#1e242d';
    ctx.fillRect(0, 0, CANVAS_WIDTH, TIMING.GROUND_Y);

    // 거대한 관과 흰 건물 벽체
    const p = 90;
    const off = (camX * 0.5) % p;
    for (let x = -off; x < CANVAS_WIDTH + p; x += p) {
      const rx = Math.round(x);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(rx, 20, p - 4, TIMING.GROUND_Y - 20);
      ctx.fillStyle = '#475569';
      ctx.fillRect(rx + 15, 0, 10, TIMING.GROUND_Y); // 수직 쇠관
    }
  };

  // 거리 보도블록
  const renderStreetFloor = (ctx: CanvasRenderingContext2D, camX: number) => {
    ctx.fillStyle = '#252930';
    ctx.fillRect(0, TIMING.GROUND_Y, CANVAS_WIDTH, CANVAS_HEIGHT - TIMING.GROUND_Y);
    ctx.fillStyle = '#4a515c';
    ctx.fillRect(0, TIMING.GROUND_Y, CANVAS_WIDTH, 2);

    // 흰색과 연두 보도 블록
    const blockWidth = 14;
    const startIdx = Math.floor(camX / blockWidth);
    const offset = camX % blockWidth;

    for (let x = -offset; x < CANVAS_WIDTH + blockWidth; x += blockWidth) {
      const idx = startIdx + Math.floor((x + offset) / blockWidth);
      ctx.fillStyle = (idx % 2 === 0) ? '#e6eaf0' : '#82a868';
      ctx.fillRect(Math.round(x), TIMING.GROUND_Y + 3, blockWidth - 1, 10);
    }

    // 파란 배수구 덮개
    const drainX = Math.round(200 - camX);
    ctx.fillStyle = '#1c4270';
    ctx.fillRect(drainX, TIMING.GROUND_Y + 15, 22, 10);
  };

  // 시멘트 바닥
  const renderCementFloor = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#646c78';
    ctx.fillRect(0, TIMING.GROUND_Y, CANVAS_WIDTH, CANVAS_HEIGHT - TIMING.GROUND_Y);
    ctx.fillStyle = '#2a2e33';
    ctx.fillRect(0, TIMING.GROUND_Y + 16, CANVAS_WIDTH, 6);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, TIMING.GROUND_Y + 19, CANVAS_WIDTH, 2);
  };

  /* -------------------------------------------------------------------------
     소품 및 개체 렌더링
     ------------------------------------------------------------------------- */
  const renderWoman = (ctx: CanvasRenderingContext2D, camX: number) => {
    const w = womanRef.current;
    const wx = Math.round(w.x - camX);
    ctx.save();
    ctx.translate(wx, TIMING.GROUND_Y);
    ctx.fillStyle = '#475569';
    ctx.fillRect(-6, -14, 12, 10);
    ctx.fillStyle = '#e2d4c0';
    ctx.fillRect(-4, -20, 8, 6);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(5, -4, 4, 3);
    ctx.restore();
  };

  const renderCart = (ctx: CanvasRenderingContext2D, camX: number) => {
    const cart = cartRef.current;
    const cx = Math.round(cart.x - camX);
    ctx.save();
    ctx.translate(cx, TIMING.GROUND_Y);

    // 바퀴와 천
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-18, -6, 7, 7);
    ctx.fillRect(10, -6, 7, 7);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-20, -14, 34, 4);

    if (cart.carriedPerson) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-12, -22, 12, 8);
      // 번호표 리본
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-2, -18, 3, 3);
    }

    // 거대한 수레 손잡이
    ctx.fillStyle = '#475569';
    ctx.fillRect(8, -26, 4, 20);
    ctx.fillRect(12, -28, 8, 3);

    // 수레 인물 에셋 (수레 - Su-re)
    const sureImg = characterImagesRef.current['sure'];
    if (sureImg && sureImg.complete && sureImg.naturalWidth > 0) {
      // 비정상적으로 키가 큰 자 (2m 이상): 22x44 크기
      ctx.drawImage(sureImg, 14, -48, 22, 44);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(18, -44, 9, 36);
      ctx.fillRect(18, -50, 8, 7);
    }
    ctx.restore();
  };

  const renderApparatus = (ctx: CanvasRenderingContext2D, camX: number) => {
    const app = apparatusRef.current;
    const ax = Math.round(app.x - camX);
    ctx.save();
    ctx.translate(ax, TIMING.GROUND_Y);
    ctx.scale(app.facing, 1);

    // 바퀴 셋
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-15, -7, 7, 7);
    ctx.fillRect(-2, -7, 7, 7);
    ctx.fillRect(11, -7, 7, 7);

    // 파란 네모 몸통
    let bodyColor = '#1c4270';
    if (app.hitFlashTimer > 0) bodyColor = '#ef4444';
    if (app.deflectFlashTimer > 0) bodyColor = '#93c5fd';
    if (app.isSubdued) bodyColor = '#16283d';
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-18, -26, 36, 19);

    // 유리알
    let eyeColor = '#38bdf8';
    if (app.stage === 'stage4_blink') eyeColor = app.blinkVisible ? '#fef08a' : '#1e3857';
    if (app.stage === 'stage5_rest') eyeColor = '#4ade80';
    if (app.isSubdued) eyeColor = '#0f172a';
    ctx.fillStyle = eyeColor;
    ctx.fillRect(-3, -15, 6, 6);

    // 장대와 고리
    if (!app.isSubdued) {
      const rodLen = app.rodProgress * 38;
      if (rodLen > 1) {
        ctx.fillStyle = '#64748b';
        ctx.fillRect(16, -17, rodLen, 3);
        const ringX = 16 + rodLen;
        ctx.fillStyle = '#94a3b8';
        if (app.ringClosed) {
          ctx.fillRect(ringX, -22, 7, 11);
        } else {
          ctx.fillRect(ringX, -23, 6, 3);
          ctx.fillRect(ringX, -13, 6, 3);
        }
      }
    }
    ctx.restore();
  };

  const renderRoofApparatus = (ctx: CanvasRenderingContext2D, camX: number) => {
    const roof = roofApparatusRef.current;
    const rx = Math.round(roof.x - camX);
    ctx.save();
    ctx.translate(rx, TIMING.GROUND_Y);

    // 거대한 사육장 지붕 설비 (6개의 유리알과 4개의 팔)
    ctx.fillStyle = '#1c3452';
    ctx.fillRect(-35, -55, 70, 50);

    // 6개의 유리알
    for (let e = 0; e < 6; e++) {
      const ex = -24 + (e % 3) * 18;
      const ey = -45 + Math.floor(e / 3) * 16;
      ctx.fillStyle = e < roof.eyesBroken ? '#0a101a' : '#38bdf8';
      ctx.fillRect(ex, ey, 8, 8);
    }
    ctx.restore();
  };

  const renderOpponent = (ctx: CanvasRenderingContext2D, camX: number) => {
    const opp = encounterOpponentRef.current;
    const ox = Math.round(opp.x - camX);
    ctx.save();
    ctx.translate(ox, TIMING.GROUND_Y);
    if (opp.state === 'DEAD') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-10, -5, 20, 5);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-4, -18, 8, 12);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-3, -24, 6, 6);
    }
    ctx.restore();
  };

  const renderSotInKitchen = (ctx: CanvasRenderingContext2D, camX: number) => {
    const sx = Math.round(180 - camX);
    ctx.save();
    ctx.translate(sx, TIMING.GROUND_Y);

    // 가마솥 (x = 20)
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(16, -26, 32, 26);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(14, -28, 36, 4);
    // 김
    const steam = Math.sin(performance.now() / 240) * 3;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(24 + steam, -40, 6, 10);
    ctx.fillRect(34 - steam, -46, 8, 14);

    // 솥 인물 에셋 (솥 - Sot)
    const sotImg = characterImagesRef.current['sot'];
    if (sotImg && sotImg.complete && sotImg.naturalWidth > 0) {
      ctx.drawImage(sotImg, -8, -34, 22, 34);
    } else {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-4, -20, 10, 14);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-3, -18, 8, 10);
      ctx.fillStyle = '#fce7d2';
      ctx.fillRect(-2, -26, 6, 6);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-3, -28, 8, 3);
    }
    ctx.restore();
  };

  const renderCheomaUnderEaves = (ctx: CanvasRenderingContext2D, camX: number) => {
    const cx = Math.round(190 - camX);
    ctx.save();
    ctx.translate(cx, TIMING.GROUND_Y);

    // 처마 밑 문지방
    ctx.fillStyle = '#453520';
    ctx.fillRect(-15, -4, 45, 4);

    // 처마 인물 에셋 (처마 - Cheoma)
    const cheomaImg = characterImagesRef.current['cheoma'];
    if (cheomaImg && cheomaImg.complete && cheomaImg.naturalWidth > 0) {
      ctx.drawImage(cheomaImg, -4, -40, 22, 38);
    } else {
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(-2, -26, 10, 22);
      ctx.fillStyle = '#e2d4c0';
      ctx.fillRect(-1, -32, 7, 7);
    }
    ctx.restore();
  };

  const renderSswaegiSaboteur = (ctx: CanvasRenderingContext2D, camX: number) => {
    const sx = Math.round(195 - camX);
    ctx.save();
    ctx.translate(sx, TIMING.GROUND_Y);

    // 박살난 설비 몸통 잔해
    ctx.fillStyle = '#16283d';
    ctx.fillRect(18, -16, 26, 16);
    ctx.fillStyle = '#b45309'; // 박힌 나무 쐐기
    ctx.fillRect(28, -20, 6, 8);

    // 쐐기 인물 에셋 (쐐기 - Sswaegi)
    const sswaegiImg = characterImagesRef.current['sswaegi'];
    if (sswaegiImg && sswaegiImg.complete && sswaegiImg.naturalWidth > 0) {
      ctx.drawImage(sswaegiImg, -8, -36, 22, 36);
    } else {
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(-4, -22, 10, 16);
      ctx.fillStyle = '#71717a';
      ctx.fillRect(4, -18, 4, 12);
      ctx.fillStyle = '#fce7d2';
      ctx.fillRect(-2, -28, 7, 6);
    }
    ctx.restore();
  };

  const renderShelterCell = (ctx: CanvasRenderingContext2D, camX: number) => {
    const sx = Math.round(180 - camX);
    ctx.save();
    ctx.translate(sx, TIMING.GROUND_Y);

    // 보호소 칸 [솥] 벤치
    ctx.fillStyle = '#334155';
    ctx.fillRect(-8, -10, 22, 10);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-12, -22, 3, 22);

    // 앉아 있는 솥 (Sot)
    const sotImg = characterImagesRef.current['sot'];
    if (sotImg && sotImg.complete && sotImg.naturalWidth > 0) {
      ctx.drawImage(sotImg, -6, -30, 18, 28);
    }

    // 서서 손을 얹은 손 (Son)
    const sonImg = characterImagesRef.current['son'];
    if (sonImg && sonImg.complete && sonImg.naturalWidth > 0) {
      ctx.drawImage(sonImg, 16, -36, 20, 36);
    } else {
      ctx.fillStyle = '#ca8a04';
      ctx.fillRect(18, -24, 8, 16);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(14, -18, 5, 4);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(19, -30, 6, 6);
    }
    ctx.restore();
  };

  const renderChapter13Crowd = (ctx: CanvasRenderingContext2D, camX: number) => {
    const t = endingCrowdStepRef.current;

    // 1. 일반 군중들 (벽에서 떨어져 나와 서는 이들)
    for (let i = 0; i < 9; i++) {
      const baseX = 135 + i * 14;
      const curX = Math.round(baseX - camX);
      const curY = Math.round(TIMING.GROUND_Y - (1 - t) * 12);

      ctx.save();
      ctx.translate(curX, curY);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-3, -7, 2, 7);
      ctx.fillRect(1, -7, 2, 7);
      ctx.fillStyle = '#334155';
      ctx.fillRect(-4, -18, 8, 12);
      ctx.fillStyle = '#d4c7b8';
      ctx.fillRect(-2, -24, 5, 6);

      if (i === 0) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(-5, -12, 2, 4); // 손목의 바랜 파란 리본 (0413)
      }
      ctx.restore();
    }

    // 2. 함께 벽을 벗어나 선 인물들 (솥, 처마, 쐐기)
    const yOff = Math.round((1 - t) * 12);

    // 솥 (Sot)
    const sotImg = characterImagesRef.current['sot'];
    if (sotImg && sotImg.complete && sotImg.naturalWidth > 0) {
      ctx.drawImage(sotImg, Math.round(155 - camX), TIMING.GROUND_Y - 32 - yOff, 18, 30);
    }

    // 처마 (Cheoma)
    const cheomaImg = characterImagesRef.current['cheoma'];
    if (cheomaImg && cheomaImg.complete && cheomaImg.naturalWidth > 0) {
      ctx.drawImage(cheomaImg, Math.round(175 - camX), TIMING.GROUND_Y - 36 - yOff, 18, 34);
    }

    // 쐐기 (Sswaegi)
    const sswaegiImg = characterImagesRef.current['sswaegi'];
    if (sswaegiImg && sswaegiImg.complete && sswaegiImg.naturalWidth > 0) {
      ctx.drawImage(sswaegiImg, Math.round(195 - camX), TIMING.GROUND_Y - 34 - yOff, 18, 32);
    }
  };

  /* -------------------------------------------------------------------------
     장발의 건장한 남성 주인공 렌더링
     ------------------------------------------------------------------------- */
  const renderMalePlayer = (ctx: CanvasRenderingContext2D, camX: number) => {
    const p = playerRef.current;
    const px = Math.round(p.x - camX);
    const py = Math.round(p.y);

    if (p.invulnerableTimer > 0 && Math.floor(performance.now() / 60) % 2 === 0) return;

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(p.facing, 1);

    // 13장: 보도 블록 위에 회색으로 누운 모습
    if (currentChapterRef.current === 'CH13') {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-15, -5, 28, 5);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-18, -7, 7, 7);
      ctx.restore();
      return;
    }

    // 구르기
    if (p.state === 'roll') {
      const angle = (p.stateTimer / TIMING.ROLL_DURATION) * Math.PI * 2;
      ctx.save();
      ctx.translate(0, -9);
      ctx.rotate(angle);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = '#808080';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
      ctx.restore();
      return;
    }

    // 태클 상태
    if (p.state === 'tackle') {
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(-9, -10, 15, 8);
      ctx.fillStyle = '#828282';
      ctx.fillRect(-6, -18, 11, 9);
      ctx.fillStyle = '#fce7d2';
      ctx.fillRect(-2, -24, 7, 7);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-7, -26, 8, 14);
      ctx.restore();
      return;
    }

    const walkBob = (p.state === 'walk') ? Math.sin(p.stateTimer * 20) * 1.5 : 0;
    const bodyY = -18 + walkBob;

    // 1. 탄탄한 하체와 짙은 차콜 바지 & 검은 신발
    ctx.fillStyle = '#3a3a3a';
    if (p.state === 'walk') {
      const legOff = Math.sin(p.stateTimer * 20) * 4;
      ctx.fillRect(-5 + legOff, -11, 4, 7);
      ctx.fillRect(1 - legOff, -11, 4, 7);
    } else {
      ctx.fillRect(-5, -11, 4, 7);
      ctx.fillRect(1, -11, 4, 7);
    }
    ctx.fillStyle = '#fce7d2';
    ctx.fillRect(-4, -4, 3, 2);
    ctx.fillRect(1, -4, 3, 2);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(-6, -2, 5, 2);
    ctx.fillRect(1, -2, 5, 2);

    // 2. 남성의 넓고 각진 어깨(너비 11px)와 회색 롱슬리브
    ctx.fillStyle = '#828282';
    ctx.fillRect(-5, bodyY, 11, 4);
    ctx.fillRect(-4, bodyY + 3, 9, 8);
    ctx.fillStyle = '#262626';
    ctx.fillRect(-4, bodyY + 10, 9, 2);

    // 팔 & 붕대
    if (p.state === 'attack') {
      if (p.stateTimer < TIMING.ATTACK_WINDUP) {
        ctx.fillStyle = '#828282';
        ctx.fillRect(-6, bodyY + 1, 4, 5);
      } else if (p.stateTimer < TIMING.ATTACK_WINDUP + TIMING.ATTACK_ACTIVE) {
        ctx.fillStyle = '#828282';
        ctx.fillRect(2, bodyY + 1, 12, 4);
        ctx.fillStyle = '#fce7d2';
        ctx.fillRect(14, bodyY + 1, 4, 4);
        if (p.hasBandages) {
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(12, bodyY + 1, 3, 4);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(18, bodyY, 5, 6);
      } else {
        ctx.fillStyle = '#828282';
        ctx.fillRect(2, bodyY + 2, 7, 4);
      }
    } else {
      ctx.fillStyle = '#828282';
      ctx.fillRect(3, bodyY + 1, 3, 7);
      ctx.fillStyle = '#fce7d2';
      ctx.fillRect(3, bodyY + 8, 3, 3);
      if (p.hasBandages) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(2, bodyY + 6, 4, 3);
      }
    }

    // 3. 머리: 장발의 남성 (뒤로 낮게 묶여 떨어지는 흑발, 각진 남성 턱선)
    ctx.fillStyle = '#111827';
    ctx.fillRect(-7, bodyY - 7, 4, 15);
    ctx.fillRect(-6, bodyY - 4, 3, 10);

    ctx.fillStyle = '#fce7d2';
    ctx.fillRect(-1, bodyY - 2, 4, 3); // 굵은 목
    ctx.fillRect(-2, bodyY - 8, 7, 7); // 각진 턱과 볼
    ctx.fillRect(2, bodyY - 4, 3, 3);

    ctx.fillStyle = '#111827';
    ctx.fillRect(-4, bodyY - 10, 8, 3);
    ctx.fillRect(-5, bodyY - 8, 3, 6);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(1, bodyY - 6, 2, 1); // 눈

    ctx.restore();
  };

  const renderChapterHeader = (ctx: CanvasRenderingContext2D) => {
    if (chapterTitleTimerRef.current <= 0) return;
    const text = CHAPTER_NAMES[currentChapterRef.current];
    const alpha = Math.min(1, chapterTitleTimerRef.current);

    ctx.save();
    ctx.fillStyle = `rgba(11, 13, 16, ${alpha * 0.88})`;
    ctx.fillRect(10, 10, 135, 20);
    ctx.strokeStyle = `rgba(56, 189, 248, ${alpha * 0.9})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(10.5, 10.5, 134, 19);

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, 16, 23);
    ctx.restore();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen flex flex-col items-center justify-center bg-[#0b0d10] text-slate-200 select-none overflow-hidden"
    >
      <div
        className="relative overflow-hidden shadow-2xl bg-black"
        style={{
          width: CANVAS_WIDTH * scale,
          height: CANVAS_HEIGHT * scale,
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="pixelated w-full h-full block cursor-default"
        />

        {/* 대화창 & 선택지 UI (흰 바탕에 파란 테두리) */}
        {modalState.visible && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/55 z-20 pointer-events-auto"
            style={{ imageRendering: 'auto' }}
          >
            <div
              className="bg-white border-2 border-[#1c4e80] shadow-2xl p-3.5 w-[280px] max-w-[90%] text-slate-900 flex flex-col gap-2.5 font-sans"
              style={{
                transform: `scale(${Math.max(1, scale * 0.75)})`,
                transformOrigin: 'center center',
              }}
            >
              {/* 화자 프로필 헤더 */}
              {modalState.speaker && CHARACTERS[modalState.speaker] && (
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-200">
                  <img
                    src={CHARACTERS[modalState.speaker].src}
                    alt={CHARACTERS[modalState.speaker].name}
                    className="w-9 h-9 object-cover rounded border border-[#1c4e80]/50 bg-slate-100 pixelated shrink-0 shadow-sm"
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-bold text-[#1c4e80] tracking-tight leading-tight truncate">
                      {modalState.speakerName || CHARACTERS[modalState.speaker].name}
                    </span>
                    <span className="text-[9px] text-slate-500 truncate">
                      {CHARACTERS[modalState.speaker].role}
                    </span>
                  </div>
                </div>
              )}

              {/* 대화 문장 */}
              <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-slate-800">
                {modalState.lines.map((line, idx) => (
                  <p key={idx} className="m-0 tracking-tight font-medium">
                    {line}
                  </p>
                ))}
              </div>

              {modalState.type === 'ENCOUNTER_CHOICE' ? (
                <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      if (modalState.onConfirm) modalState.onConfirm('spare');
                    }}
                    onMouseEnter={() => {
                      sounds.playSelect();
                      setModalState(prev => ({ ...prev, choice: 'spare' }));
                    }}
                    className={`flex-1 py-1.5 px-3 text-xs font-semibold tracking-wide border transition-all text-center ${
                      modalState.choice === 'spare'
                        ? 'bg-[#1c4e80] text-white border-[#1c4e80] shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    살린다
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (modalState.onConfirm) modalState.onConfirm('kill');
                    }}
                    onMouseEnter={() => {
                      sounds.playSelect();
                      setModalState(prev => ({ ...prev, choice: 'kill' }));
                    }}
                    className={`flex-1 py-1.5 px-3 text-xs font-semibold tracking-wide border transition-all text-center ${
                      modalState.choice === 'kill'
                        ? 'bg-[#1c4e80] text-white border-[#1c4e80] shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    죽인다
                  </button>
                </div>
              ) : (
                <div className="flex justify-end pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (modalState.onConfirm) modalState.onConfirm(modalState.choice);
                    }}
                    className="py-1 px-3.5 text-xs font-semibold bg-[#1c4e80] text-white border border-[#1c4e80] hover:bg-[#153a61]"
                  >
                    계속 (Z / Space)
                  </button>
                </div>
              )}

              <div className="text-[9px] text-slate-400 text-center select-none pt-0.5">
                {modalState.type === 'ENCOUNTER_CHOICE'
                  ? '← / → 선택 · Z / Enter 확정'
                  : 'Z / Space / Enter 넘김'}
              </div>
            </div>
          </div>
        )}

        {/* 13장 수레의 최종 독백 */}
        {currentChapterRef.current === 'CH13' && sparedCountRef.current >= 1 && endingCrowdStepRef.current >= 0.95 && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[88%] bg-white/95 border-2 border-[#1c4e80] p-2.5 shadow-xl text-slate-900 z-15 flex items-start gap-2.5"
            style={{
              transform: `translateX(-50%) scale(${Math.max(1, scale * 0.7)})`,
              transformOrigin: 'bottom center',
            }}
          >
            <img
              src={CHARACTERS.sure.src}
              alt="수레"
              className="w-10 h-10 object-cover rounded border border-[#1c4e80]/40 pixelated shrink-0 mt-0.5"
            />
            <div className="flex flex-col text-left">
              <span className="text-[10px] font-bold text-[#1c4e80]">{CHARACTERS.sure.name}</span>
              <p className="text-[10px] leading-relaxed font-medium m-0 text-slate-800">
                "자네들이 방금 무엇을 버린 것인지 알고 있나?<br />
                편안한 삶을 잃고 죽음을 얻었고, 통제를 잃고 혼란을 얻었으며,<br />
                순환을 멈춤으로서 일상을 잃었네. 자네들이 이겼네 인간들이여."
              </p>
              <p className="text-[8px] text-slate-500 m-0 pt-1">아무도 대답하지 않고, 비키지 않았다.</p>
            </div>
          </div>
        )}
      </div>

      {/* 상단 툴바 */}
      <div className="absolute top-3 right-4 flex items-center gap-2 text-xs text-slate-400 z-10">
        <button
          type="button"
          onClick={() => setIsCodexOpen(true)}
          className="px-2.5 py-1 rounded bg-[#16283d] hover:bg-[#1c3857] border border-[#234e7a] text-sky-200 hover:text-white transition-all flex items-center gap-1.5 text-[11px] font-medium shadow-sm"
          title="소설 속 등장인물 6인 에셋 및 도감"
        >
          <Users size={13} className="text-sky-400" />
          <span>인물록 (6인)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = !isMuted;
            setIsMuted(next);
            sounds.enabled = !next;
          }}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title={isMuted ? '소리 켜기' : '소리 끄기'}
          aria-label="소리 토글"
        >
          {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        <button
          type="button"
          onClick={() => {
            const nextScale = scale >= 4 ? 2 : scale + 1;
            setScale(nextScale);
          }}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 text-[11px] font-mono"
          title="화면 크기"
        >
          <Maximize2 size={13} />
          <span>{scale}x</span>
        </button>

        <button
          type="button"
          onClick={restartGame}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="1장부터 다시 시작"
          aria-label="재시작"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* 모바일 터치 패드 */}
      <div className="sm:hidden absolute bottom-3 w-full px-6 flex justify-between items-center z-10 pointer-events-auto">
        <div className="flex gap-2">
          <button
            type="button"
            onTouchStart={() => { keysDownRef.current['arrowleft'] = true; }}
            onTouchEnd={() => { keysDownRef.current['arrowleft'] = false; }}
            className="w-11 h-11 bg-slate-800/80 active:bg-slate-700 rounded border border-slate-700 flex items-center justify-center font-bold text-sm text-slate-300"
          >
            ←
          </button>
          <button
            type="button"
            onTouchStart={() => { keysDownRef.current['arrowright'] = true; }}
            onTouchEnd={() => { keysDownRef.current['arrowright'] = false; }}
            className="w-11 h-11 bg-slate-800/80 active:bg-slate-700 rounded border border-slate-700 flex items-center justify-center font-bold text-sm text-slate-300"
          >
            →
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onTouchStart={() => { keysDownRef.current['x'] = true; }}
            onTouchEnd={() => { keysDownRef.current['x'] = false; }}
            className="w-10 h-10 bg-slate-800/80 active:bg-slate-700 rounded border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300"
          >
            구르기
          </button>
          <button
            type="button"
            onTouchStart={() => { keysDownRef.current[' '] = true; }}
            onTouchEnd={() => { keysDownRef.current[' '] = false; }}
            className="w-10 h-10 bg-slate-800/80 active:bg-slate-700 rounded border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300"
          >
            점프
          </button>
          <button
            type="button"
            onTouchStart={() => {
              if (modalState.visible && modalState.onConfirm) {
                modalState.onConfirm(modalState.choice);
              } else {
                keysDownRef.current['z'] = true;
              }
            }}
            onTouchEnd={() => { keysDownRef.current['z'] = false; }}
            className="w-11 h-11 bg-blue-900/80 active:bg-blue-800 rounded border border-blue-700 flex items-center justify-center font-bold text-xs text-blue-200"
          >
            공격/선택
          </button>
        </div>
      </div>

      {/* 인물록 (Character Codex) 모달 */}
      {isCodexOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
          onClick={() => setIsCodexOpen(false)}
        >
          <div
            className="bg-[#0f172a] border border-[#1e3a5f] rounded-xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl text-slate-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#14233c]/60">
              <div className="flex items-center gap-2.5">
                <Users className="w-5 h-5 text-sky-400" />
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white tracking-tight m-0">
                    원작 소설 등장인물록 (Character Archive)
                  </h2>
                  <p className="text-[11px] text-slate-400 m-0">
                    소설 《설비》의 묘사에 따라 단독 제작된 6인의 도트 픽셀 캐릭터 에셋
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCodexOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="닫기 (ESC)"
              >
                <X size={18} />
              </button>
            </div>

            {/* 인물 카드 그리드 */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
              {(['main', 'sure', 'sot', 'cheoma', 'sswaegi', 'son'] as CharacterId[]).map((id) => {
                const char = CHARACTERS[id];
                return (
                  <div
                    key={id}
                    className="flex gap-3.5 p-3.5 rounded-lg bg-[#162238]/70 border border-slate-800 hover:border-sky-700/60 transition-all"
                  >
                    {/* 도트 에셋 썸네일 */}
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      <div className="w-16 h-16 rounded-md bg-black/50 border border-[#234e7a] p-1 flex items-center justify-center shadow-inner">
                        <img
                          src={char.src}
                          alt={char.name}
                          className="w-full h-full object-contain pixelated"
                        />
                      </div>
                      <span className="text-[9px] text-sky-400/90 font-mono">
                        {id.toUpperCase()}
                      </span>
                    </div>

                    {/* 인물 정보 */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-1 flex-wrap">
                        <h3 className="text-xs sm:text-sm font-bold text-white m-0">
                          {char.name}
                        </h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/50">
                          {char.role}
                        </span>
                      </div>

                      <div className="mt-1 text-[11px] text-slate-300 leading-snug">
                        <p className="m-0 text-slate-400">
                          <strong className="text-slate-200">외형:</strong> {char.appearance}
                        </p>
                      </div>

                      <div className="mt-1 text-[10px] text-slate-400 leading-tight">
                        <strong className="text-slate-300">등장:</strong> {char.chapters}
                      </div>

                      <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-sky-200/90 italic font-serif">
                        {char.quotes[0]}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 푸터 */}
            <div className="px-5 py-2.5 border-t border-slate-800 bg-[#0d1525] flex justify-between items-center text-[11px] text-slate-400">
              <span>내부 해상도 320×180 캔버스 및 대화창에 직접 렌더링됩니다.</span>
              <button
                type="button"
                onClick={() => setIsCodexOpen(false)}
                className="px-3 py-1 bg-sky-900/60 hover:bg-sky-800 text-sky-100 border border-sky-700/60 rounded text-xs transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
