/**
 * Lesson text: motor start / stop with a ladder diagram (the PLC rack, the addresses, the
 * self-holding rung and why the stop button is wired the other way round). Original text for
 * MachSim. See src/i18n/lessons/index.ts.
 */
import { L } from '../core';
import type { LessonText } from './index';

export const LADDER_LESSON_TEXT: Record<string, LessonText> = {
  'ladder-start-stop': {
    title: L('Khởi động / dừng động cơ bằng sơ đồ bậc thang', 'Motor start / stop with a ladder diagram'),
    goal: L(
      'Dựng một giá PLC nhỏ, viết bậc thang tự giữ và kiểm tra: nhấn nút khởi động rồi nhả ra, động cơ vẫn chạy; nhấn nút dừng thì tắt.',
      'Build a small PLC rack, write the self-holding rung and check it: press the start button and release it — the motor keeps running; press stop and it goes off.',
    ),
    theory: L(
      `## Bộ điều khiển lập trình làm gì
Một bộ điều khiển lập trình (PLC) lặp đi lặp lại một **vòng quét**:

1. đọc mọi ngõ vào và ghi vào *ảnh ngõ vào*;
2. chạy lần lượt từng bậc của chương trình, từ trên xuống;
3. ghi *ảnh ngõ ra* ra các chân.

Chu kỳ quét ở MachSim mặc định là 10 ms, và đó cũng là độ phân giải của các bộ định thời.

## Đọc một bậc thang
Hai ray dọc là “nguồn”. Mỗi bậc đi từ ray trái, qua các tiếp điểm, tới cuộn dây ở ray phải:

- tiếp điểm **nối tiếp** nhau là phép **VÀ**;
- tiếp điểm **xếp trên nhau** là phép **HOẶC**;
- tiếp điểm **thường mở** đóng khi bit bằng 1, **thường đóng** đóng khi bit bằng 0.

## Địa chỉ
Chương trình không biết gì về dây: nó chỉ biết địa chỉ. Kênh k của mô-đun vào có byte địa chỉ 0 là **I0.k**, kênh ra là **Q0.k**, bit nhớ trong là **M0.k**.

## Vì sao phải tự giữ
Nút nhấn chỉ đóng **trong lúc** nhấn. Nếu bậc chỉ là “I0.0 → Q0.0” thì động cơ chạy khi còn giữ nút và tắt ngay khi nhả. Cách làm đúng: mắc **song song** với tiếp điểm của nút khởi động một tiếp điểm thường mở của **chính cuộn dây**, rồi nối tiếp cả nhóm với tiếp điểm của nút dừng:

$$Q_{0.0} = (I_{0.0} + Q_{0.0}) \\cdot I_{0.1}$$

Đọc ra lời: “(khởi động HOẶC đang chạy) VÀ chưa dừng → chạy”. Tiếp điểm Q0.0 trong bậc chính là “mạch duy trì” của tủ điện rơ-le.

## Nút dừng trong tủ điện thật
Nút dừng luôn là tiếp điểm **thường đóng**: nếu dây tới nút bị đứt, mạch phải **dừng** chứ không được chạy tiếp. Vì nút thường đóng nên ngõ vào I0.1 ở mức 1 khi *không* nhấn, do đó trong chương trình nó là tiếp điểm **thường mở**. Đây là chỗ nhầm phổ biến nhất của bài học này.`,
      `## What a programmable controller does
A programmable controller (PLC) repeats one **scan** over and over:

1. read every input into the *input image*;
2. run the rungs of the program, one after another, top to bottom;
3. write the *output image* to the pins.

The scan period in MachSim is 10 ms by default, and it is also the resolution of the timers.

## Reading a rung
The two vertical rails are the “supply”. Each rung runs from the left rail, through the contacts, to a coil on the right rail:

- contacts **in series** are an **AND**;
- contacts **stacked** over each other are an **OR**;
- a **normally open** contact is closed while the bit is 1, a **normally closed** one while the bit is 0.

## Addresses
The program knows nothing about wires: it only knows addresses. Channel k of an input module with address byte 0 is **I0.k**, an output channel is **Q0.k** and an internal memory bit is **M0.k**.

## Why it has to hold itself
A push-button is only closed **while** it is pressed. A rung that is just “I0.0 → Q0.0” runs the motor while the finger is on the button and stops it the moment the button is released. The right answer: put a normally-open contact of the **coil itself** in **parallel** with the start contact, and put that group in series with the stop contact:

$$Q_{0.0} = (I_{0.0} + Q_{0.0}) \\cdot I_{0.1}$$

Read it out loud: “(start OR already running) AND not stopped → run”. That Q0.0 contact is exactly the hold-in contact of a relay cabinet.

## The stop button in a real cabinet
A stop button is always a **normally closed** contact: if its wire breaks, the machine must **stop**, not keep running. Because the button is normally closed, input I0.1 is at 1 while it is *not* pressed, so in the program it is a **normally open** contact. This is the mistake almost everyone makes first.`,
    ),
    steps: {
      rack: {
        task: L('Đặt một mô-đun vào, một mô-đun ra và thêm một trang sơ đồ bậc thang.', 'Place an input module and an output module, and add a ladder sheet.'),
        hint: L(
          'Thư viện: nhóm “Số linh tinh” → họ “Giá PLC”. Trang bậc thang: menu Đặt → Trang sơ đồ bậc thang. Nối chân COM của cả hai mô-đun xuống đất.',
          'Library: Misc digital group → “PLC rack” family. The ladder sheet: Place → Ladder sheet. Tie the COM pins of both modules to ground.',
        ),
      },
      wiring: {
        task: L('Nối hai nút nhấn vào hai kênh vào, và một đèn (hay động cơ) vào một kênh ra.', 'Wire two push-buttons to two input channels, and a lamp (or a motor) to an output channel.'),
        hint: L(
          'Nút nhấn nối từ ray +24 V tới chân kênh I0 và I1. Đèn nối từ chân Q0 xuống COM. Đặt nút dừng S2 ở chế độ “thường đóng” trong Thuộc tính.',
          'Each button goes from the +24 V rail to a channel pin, I0 and I1. The lamp goes from pin Q0 down to COM. Set the stop button S2 to “normally closed” in Properties.',
        ),
      },
      program: {
        task: L('Vẽ một bậc có cuộn dây Q0.0 và không còn chỗ nào báo lỗi.', 'Draw one rung with a Q0.0 coil and no problems left.'),
        hint: L(
          'Trên trang bậc thang: “Thêm bậc”, nhấp vào tiếp điểm rồi sửa địa chỉ ở ô bên dưới. Nút “Nối tiếp” và “Song song” thêm tiếp điểm.',
          'On the ladder sheet: “Add rung”, click a contact and edit its address in the strip below. The “In series” and “In parallel” buttons add contacts.',
        ),
      },
      holds: {
        task: L('Làm cho bậc tự giữ: nhả nút khởi động mà động cơ vẫn chạy, nhấn nút dừng thì tắt.', 'Make the rung hold itself: releasing the start button leaves the motor running, and the stop button switches it off.'),
        hint: L(
          'Thêm một tiếp điểm thường mở của Q0.0 SONG SONG với tiếp điểm của nút khởi động, rồi nối tiếp cả nhóm đó với tiếp điểm của nút dừng.',
          'Add a normally-open contact of Q0.0 IN PARALLEL with the start contact, then put that group in series with the stop contact.',
        ),
      },
    },
    quiz: {
      hold: {
        q: L('Tiếp điểm Q0.0 trong bậc dùng để làm gì?', 'What is the Q0.0 contact in the rung for?'),
        options: [
          L('Giữ cho cuộn dây có điện sau khi nhả nút khởi động', 'To keep the coil energised after the start button is released'),
          L('Để đo điện áp của cuộn dây', 'To measure the voltage of the coil'),
          L('Để đảo trạng thái cuộn dây mỗi vòng quét', 'To toggle the coil on every scan'),
        ],
        why: L(
          'Đó là mạch duy trì: khi cuộn dây đã có điện, tiếp điểm của chính nó thay nút khởi động giữ bậc tiếp tục dẫn.',
          'It is the hold-in path: once the coil is energised, its own contact takes over from the start button and keeps the rung conducting.',
        ),
      },
      stop: {
        q: L('Nút dừng là tiếp điểm thường đóng. Trong chương trình nó phải là tiếp điểm nào?', 'The stop button is a normally closed contact. What must it be in the program?'),
        options: [
          L('Thường đóng', 'Normally closed'),
          L('Thường mở', 'Normally open'),
          L('Tiếp điểm sườn lên', 'A rising-edge contact'),
        ],
        why: L(
          'Nút thường đóng làm ngõ vào ở mức 1 khi chưa nhấn, nên tiếp điểm thường mở của ngõ vào đó đang dẫn; nhấn nút thì ngõ vào về 0 và bậc mất điện.',
          'A normally closed button holds the input at 1 while it is not pressed, so a normally open contact of that input conducts; pressing the button takes the input to 0 and the rung drops out.',
        ),
      },
      scan: {
        q: L('Trong một vòng quét, bậc 2 đọc một bit mà bậc 1 vừa ghi. Nó thấy giá trị nào?', 'Within one scan, rung 2 reads a bit that rung 1 has just written. Which value does it see?'),
        options: [
          L('Giá trị của vòng quét trước', 'The value of the previous scan'),
          L('Không đọc được', 'It cannot read it'),
          L('Giá trị mới mà bậc 1 vừa ghi', 'The new value rung 1 has just written'),
        ],
        why: L(
          'Các bậc chạy lần lượt trên cùng một ảnh, nên bậc dưới thấy ngay giá trị bậc trên vừa ghi. Vì thế thứ tự các bậc có ý nghĩa.',
          'The rungs run one after another on the same image, so a later rung sees at once what an earlier one wrote. That is why the order of the rungs matters.',
        ),
      },
    },
  },
};
