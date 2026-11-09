/**
 * Lesson text: the 8051 microcontroller blinking an LED (wiring a port pin, writing the program,
 * reading the delay in machine cycles). Original text for MachSim. See src/i18n/lessons/index.ts.
 */
import { L } from '../core';
import type { LessonText } from './index';

export const MCU_TEXT: Record<string, LessonText> = {
  'mcu-blink': {
    title: L('Vi điều khiển 8051 nháy LED', 'An 8051 blinking an LED'),
    goal: L(
      'Nối LED vào chân P1.0 của vi điều khiển 8051, viết chương trình nháy LED và đo chu kỳ nháy.',
      'Wire an LED to port pin P1.0 of an 8051, write the blink program and measure its period.',
    ),
    theory: L(
      `## Vi điều khiển là gì
Vi điều khiển 8051 là một máy tính nhỏ trong một con chip: bộ xử lý 8 bit, 256 byte RAM, hai bộ định thời, cổng nối tiếp và bốn cổng vào / ra P0…P3. Thay vì nối dây để tạo hàm logic, bạn **viết chương trình**.

## Chu kỳ máy
Mọi thời gian của 8051 đều đếm theo **chu kỳ máy** = 12 chu kỳ thạch anh:

$$T_{may} = \\frac{12}{f_{XTAL}}$$

Với $f_{XTAL}$ = 12 MHz thì một chu kỳ máy bằng 1 µs. Phần lớn lệnh mất 1 chu kỳ; lệnh nhảy và gọi mất 2; MUL và DIV mất 4. Nhờ vậy tính được thời gian một vòng trễ bằng giấy bút:

- \\\`MOV R6,#250\\\` mất 1 chu kỳ;
- \\\`DJNZ R6,D2\\\` lặp 250 lần, mỗi lần 2 chu kỳ, tức 500 chu kỳ;
- \\\`DJNZ R7,D1\\\` mất 2 chu kỳ.

Mỗi vòng ngoài mất 503 chu kỳ; nhân 100 lần là 50 300 chu kỳ, khoảng 50,3 ms.

## Chân cổng không phải ngõ ra logic
Chân P1 của 8051 **hút** dòng xuống đất rất tốt (hàng chục mA) nhưng chỉ được treo lên mức 1 qua điện trở trong khoảng 50 kΩ, nên không đủ sức làm sáng một LED. Vì vậy LED luôn nối từ **nguồn +5 V** qua điện trở xuống chân, và chương trình cho chân **xuống 0** để LED sáng:

$$I = \\frac{5 - U_F}{R}$$

Với LED đỏ ($U_F$ khoảng 1,9 V) và $R$ = 330 Ω thì $I$ khoảng 9 mA.

## Chương trình nháy LED
Vòng chính: \\\`CPL P1.0\\\` đảo chân, \\\`ACALL DELAY\\\` chờ, \\\`SJMP MAIN\\\` quay lại. Chương trình con trễ: \\\`MOV R7,#100\\\`, rồi hai vòng \\\`DJNZ\\\` lồng nhau, cuối cùng \\\`RET\\\`. Đừng quên \\\`ORG 0\\\` ở đầu và \\\`END\\\` ở cuối.`,
      `## What a microcontroller is
An 8051 is a small computer in one chip: an 8-bit processor, 256 bytes of RAM, two timers, a serial port and four I/O ports P0…P3. Instead of wiring gates to make a logic function, you **write a program**.

## The machine cycle
Everything an 8051 does is counted in **machine cycles** = 12 oscillator periods:

$$T_{cycle} = \\frac{12}{f_{XTAL}}$$

With $f_{XTAL}$ = 12 MHz one machine cycle is 1 µs. Most instructions take 1 cycle; jumps and calls take 2; MUL and DIV take 4. So the time of a delay loop can be worked out on paper:

- \\\`MOV R6,#250\\\` takes 1 cycle;
- \\\`DJNZ R6,D2\\\` repeats 250 times at 2 cycles each, that is 500 cycles;
- \\\`DJNZ R7,D1\\\` takes 2 cycles.

Each outer pass costs 503 cycles; a hundred of them is 50,300 cycles, about 50.3 ms.

## A port pin is not a logic output
A P1 pin of an 8051 **sinks** current to ground very well (tens of mA) but is only held at 1 through an internal resistor of about 50 kΩ, so it cannot light an LED. That is why the LED always hangs from the **+5 V supply** through a resistor down to the pin, and the program pulls the pin **low** to light it:

$$I = \\frac{5 - V_F}{R}$$

With a red LED ($V_F$ about 1.9 V) and $R$ = 330 Ω that is about 9 mA.

## The blink program
The main loop: \\\`CPL P1.0\\\` inverts the pin, \\\`ACALL DELAY\\\` waits, \\\`SJMP MAIN\\\` goes back. The delay subroutine: \\\`MOV R7,#100\\\`, then two nested \\\`DJNZ\\\` loops, and \\\`RET\\\` at the end. Do not forget \\\`ORG 0\\\` at the top and \\\`END\\\` at the bottom.`,
    ),
    steps: {
      mcu: {
        task: L('Đặt một vi điều khiển (Vi điều khiển 8051 hoặc bản (P1)).', 'Place a microcontroller (MCU 8051, or the (P1) version).'),
        hint: L('Nhóm Số linh tinh → họ Vi điều khiển. Bản ký hiệu gọn (P1) đủ cho bài này.', 'Misc digital → Microcontroller family. The small (P1) symbol is enough for this lesson.'),
      },
      led: {
        task: L('Nối LED và điện trở hạn dòng từ +5 V xuống chân P1.0.', 'Wire an LED and a series resistor from +5 V down to pin P1.0.'),
        hint: L(
          'Chân 8051 hút dòng tốt nhưng đẩy dòng rất kém: LED phải treo từ nguồn xuống chân, không phải từ chân xuống đất. Điện trở 330 Ω cho khoảng 9 mA.',
          'An 8051 pin sinks current but barely sources any: the LED must hang from the supply down to the pin, not from the pin to ground. 330 Ω gives about 9 mA.',
        ),
      },
      program: {
        task: L('Viết chương trình đổi mức chân P1.0 trong một vòng lặp vô tận, và dịch không lỗi.', 'Write a program that changes P1.0 inside an endless loop, and build it without an error.'),
        hint: L(
          'Nhấp đúp vào linh kiện để mở Trình soạn mã. Lệnh CPL P1.0 đảo chân; ACALL DELAY và SJMP MAIN tạo vòng lặp. Nhấn Dịch.',
          'Double-click the part to open the code editor. CPL P1.0 inverts the pin; ACALL DELAY and SJMP MAIN make the loop. Press Build.',
        ),
      },
      blink: {
        task: L('Chạy mô phỏng: chân P1.0 phải đổi mức thật.', 'Run the simulation: pin P1.0 must really change level.'),
        hint: L(
          'Nhấn Chạy (F5). Xem LED, hoặc đặt đầu dò lên P1.0. Vòng trễ 100 × 503 chu kỳ máy mất khoảng 50 ms với thạch anh 12 MHz.',
          'Press Run (F5). Watch the LED, or put a probe on P1.0. A delay loop of 100 x 503 machine cycles takes about 50 ms at 12 MHz.',
        ),
      },
    },
    quiz: {
      wiring: {
        q: L('Tại sao LED treo từ +5 V xuống chân chứ không nối từ chân xuống đất?', 'Why does the LED hang from +5 V down to the pin instead of from the pin to ground?'),
        options: [
          L('Vì nối kiểu kia sẽ làm hỏng chân', 'Because the pin would be damaged the other way round'),
          L('Vì chân hút dòng tốt nhưng đẩy dòng rất kém', 'Because the pin sinks current well but sources very little'),
          L('Vì LED chỉ sáng khi đảo chiều', 'Because an LED only works upside down'),
        ],
        why: L(
          'Cổng hai chiều kiểu 8051 kéo chân xuống 0 qua điện trở nhỏ, nhưng chỉ treo chân lên mức 1 qua điện trở trong khoảng 50 kΩ.',
          'A quasi-bidirectional port pulls a pin to 0 through a low resistance, but only holds it at 1 through an internal resistor of about 50 kΩ.',
        ),
      },
      cycle: {
        q: L('Với thạch anh 12 MHz, một chu kỳ máy dài bao nhiêu?', 'With a 12 MHz crystal, how long is one machine cycle?'),
        options: [L('12 ns', '12 ns'), L('83 ns', '83 ns'), L('1 µs', '1 µs')],
        why: L('Một chu kỳ máy bằng 12 chu kỳ thạch anh: 12 / 12 MHz = 1 µs.', 'One machine cycle is 12 oscillator periods: 12 / 12 MHz = 1 µs.'),
      },
      toggle: {
        q: L('Lệnh nào đảo một chân của cổng?', 'Which instruction inverts a single port pin?'),
        options: [L('CPL P1.0', 'CPL P1.0'), L('MOV P1,#0', 'MOV P1,#0'), L('DJNZ P1.0,MAIN', 'DJNZ P1.0,MAIN')],
        why: L('Lệnh CPL đảo một bit. MOV P1,#0 ghi cả cổng, còn DJNZ đếm một byte xuống.', 'CPL inverts one bit. MOV P1,#0 writes the whole port, and DJNZ counts a byte down.'),
      },
    },
  },
};
