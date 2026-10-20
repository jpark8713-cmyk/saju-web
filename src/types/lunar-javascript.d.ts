// lunar-javascript 1.7.7에는 타입 정의가 없다. lunar.js 원본을 읽고 이 프로젝트가 쓰는 부분만 선언한다.
declare module 'lunar-javascript' {
  export interface LjSolar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getHour(): number;
    getMinute(): number;
    getSecond(): number;
    toYmdHms(): string;
    getLunar(): LjLunar;
  }

  export interface LjDaYun {
    getIndex(): number;
    getGanZhi(): string;
    getStartAge(): number;
    getStartYear(): number;
  }

  export interface LjYun {
    getStartYear(): number;
    getStartMonth(): number;
    getStartDay(): number;
    getStartHour(): number;
    isForward(): boolean;
    getStartSolar(): LjSolar;
    getDaYun(n?: number): LjDaYun[];
  }

  export interface LjEightChar {
    setSect(sect: 1 | 2): void;
    getYear(): string;
    getMonth(): string;
    getDay(): string;
    getTime(): string;
    getYearShiShenGan(): string;
    getMonthShiShenGan(): string;
    getTimeShiShenGan(): string;
    getYearShiShenZhi(): string[];
    getMonthShiShenZhi(): string[];
    getDayShiShenZhi(): string[];
    getTimeShiShenZhi(): string[];
    getYun(gender: 0 | 1, sect?: 1 | 2): LjYun;
  }

  export interface LjLunar {
    getYear(): number;
    /** 윤달이면 음수 */
    getMonth(): number;
    getDay(): number;
    getJieQiTable(): Record<string, LjSolar>;
    getEightChar(): LjEightChar;
  }

  export const Solar: {
    fromYmd(y: number, m: number, d: number): LjSolar;
    fromYmdHms(y: number, m: number, d: number, h: number, mi: number, s: number): LjSolar;
  };

  // CommonJS 모듈이라 ESM에서는 기본 내보내기로 가져온다
  const lunarJs: { Solar: typeof Solar };
  export default lunarJs;
}
