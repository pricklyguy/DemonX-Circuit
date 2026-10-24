# ESP32-S3 reference fixture component selection

Status: **candidate circuit definition, not yet a native schematic or validated design**. This records manufacturer-source selection for the next prototype and separates datasheet facts from board-level judgments.

| Function | Candidate | Source-supported facts | Design decision and remaining check |
|---|---|---|---|
| Controller | Espressif ESP32-S3-WROOM-1-N8 | N8 is the 8 MB quad-flash module variant. Espressif module pin map exposes GPIO8, GPIO9 and GPIO10. The v1.8 module datasheet recommends keeping copper/components out of the antenna zone and provides a reference land pattern and STEP model. | Candidate GPIO map: GPIO8 SDA, GPIO9 SCL, GPIO10 relay request. These are normal GPIOs in the ESP32-S3 pin table, but validate their selected functions, boot behavior and native symbol-pad mapping before describing the firmware mapping as hardware-derived. Respect module antenna keepout in placement/routing. |
| 5 V to 3.3 V regulator | Texas Instruments TPS563201 | Active synchronous buck, 4.5–17 V input, up to 3 A output, SOT-23-THN. TI's 3.3 V recommendations: R1 33.2 kΩ, R2 10.0 kΩ, L1 2.2 µH typical (2.2–4.7 µH table range), C8+C9 20–68 µF. | Use 2.2 µH and 2 × 22 µF ceramic output capacitors as an initial reference-value selection; include the datasheet bootstrap and input decoupling circuit. Final inductor saturation/current rating, output-capacitor effective capacitance, dissipation, switch-node placement, output transient margin and thermal behavior require engineering review. A 3 A IC rating alone is not proof the board sustains that load. |
| Bare sensor | Bosch BME280 | Bosch supports I²C/SPI, VDD 1.71–3.6 V, VDDIO 1.2–3.6 V, 8-pin 2.5 × 2.5 mm LGA. ESPHome's current component is `bme280_i2c`; its docs recommend CSB tied high in I²C mode. | 3.3 V supply, 100 nF local decoupling, 4.7 kΩ SDA/SCL pull-ups, CSB high, SDO low for 0x76. Confirm exact pin numbering against Bosch datasheet and KiCad footprint courtyard/pad numbering. |
| Relay | Omron G5V-1, 5 V coil (`G5V-1-DC5`) | 5 V coil is rated 30 mA and 167 Ω at 23 °C (±10%). Must-operate voltage is at most 80% of rated; max coil voltage is 200% at 23 °C. The general G5V-1 contact table rates up to 1 A at 30 VDC under specified conditions. | Put coil on the raw 5 V input, not the 3.3 V rail. Contacts exposed on screw/header terminals are intended only for low-voltage DC in this prototype; no mains routing. Check actual switching/load type and lifetime before product use. |
| Relay switch | onsemi MMBT2222ALT1G NPN | onsemi lists 40 V minimum VCEO, 0.6 A continuous collector, SOT-23 and 225 mW max package power for this family. | Low-side collector driver with emitter at ground. Prototype values: 330 Ω base resistor and 100 kΩ base-emitter pulldown. At 3.3 V logic, the resistor limits base drive to about 8 mA (using a 0.7 V base-emitter approximation); confirm saturation voltage using the exact datasheet test conditions and validate boot/reset behavior. |
| Coil suppression | onsemi MMSD4148T1G | 100 V switching diode in SOD-123 with 200 mA maximum forward current per the onsemi datasheet. | Place directly across the coil, cathode to +5 V and anode to the transistor collector. Its datasheet pulse/thermal ratings and the exact KiCad symbol pin order still need to be checked in the native design. |

## Provenance

- Espressif [ESP32-S3-WROOM-1/1U datasheet](https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.html), version 1.8, and [ESP32-S3 series datasheet](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf).
- TI [TPS563201 product page and revision-B datasheet](https://www.ti.com/product/TPS563201); see the datasheet recommended-component table.
- Bosch [BME280 product page and datasheet](https://www.bosch-sensortec.com/en/products/environmental-sensors/humidity-sensors-bme280).
- Omron [G5V-1 datasheet](https://omronfs.omron.com/en_US/ecb/products/pdf/en-g5v_1.pdf).
- onsemi [MMBT2222A family datasheet](https://www.onsemi.com/pdf/datasheet/mmbt2222lt1-d.pdf).
- onsemi [MMSD4148T1G datasheet](https://www.onsemi.com/pdf/datasheet/mmsd4148t1-d.pdf).
- ESPHome [BME280 component documentation](https://esphome.io/components/sensor/bme280/).

## Safety and verification boundary

The resistor/coil arithmetic and part ratings are source-grounded selection inputs only. They do not verify the complete circuit, transistor saturation, power-supply stability, PCB clearances, thermal margins, antenna performance, relay transient behavior or safe firmware operation. The design remains unfit to manufacture or connect to a load until native ERC/DRC, layout review and hardware validation are complete. Relay contacts in this fixture are strictly low-voltage DC.
