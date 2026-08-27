# Reverificar antes del primer cobro real

**Una sola cosa, y es sobre a qué cuenta llega el dinero.**

## La afirmación

`landing/index.html` dice, en dos lugares:

> **«El cobro va directo a la cuenta del restaurante»**
> **«El cobro sale a nombre de tu restaurante»**

## Por qué está autorizada hoy

**Decisión de Mati, 2026-08-09**, textual:

> *«Recordá que aún no lanzamos, tener la landing y todo armado es para testing
> de usuarios SIN PAGOS y para inversores, por lo tanto el punto 1 de la lista
> no tiene sentido. No importa que el código aún no lo cumpla, el concepto es
> que lo va a cumplir y estamos dejando todo ordenado para avanzar.»*

**Sin pagos reales nadie puede ser inducido a error, y una landing para
inversores describe el producto, no el estado del deploy.** El argumento se
sostiene y por eso la frase se publicó.

## 🔴 Por qué esto igual queda escrito

**Hoy es una descripción de producto. El día que haya dinero real pasa a ser
una afirmación sobre a qué cuenta llega.** Lo que cambia no es el texto: es la
consecuencia de que sea falso.

Y el motivo de que valga la pena un archivo: **una autorización dada bajo una
condición se recuerda como una autorización a secas.** Dentro de tres meses,
cuando alguien busque por qué la landing promete eso, va a encontrar «lo
autorizó Mati» y no la condición que lo hacía correcto.

## Qué hay que verificar, concretamente

| | |
|---|---|
| **Dónde se cerró** | App Backend `cc5356c6164cd8fadc3088dedd627fe7728a2dbc` + `11af0a658e9e258e7d9d3dd2368f49c07005c8b4` |
| **Qué pasa hoy en local** | garantía y pago nuevos exigen una cuenta Connect apta y fallan cerrados; los bindings históricos `NULL` quedan en cuarentena |
| **Qué dice la política** | el acta card-only manda que una cuenta Connect no apta **falle cerrada y JAMÁS degrade a cargo de plataforma** |

✅ **HECHO_LOCAL, medido sobre App Backend `7c547456`.** Los dos commits citados
cierran el camino nuevo en la causa; no se infiere de una bandera encendida.

**Antes del primer cobro real todavía hay que acreditar staging, producción y
Stripe real.** Este cierre local no prueba configuración externa ni bytes
desplegados. Si esa verificación externa contradice el comportamiento local, la
frase se corrige o se retira; no se reinterpreta. D1-D, D1-E y los demás
bloqueos no refutados siguen siendo condiciones independientes.

## Quién lo levanta

Es decisión de Mati, y de producto. Este archivo no la toma: sólo impide que la
condición se pierda.
