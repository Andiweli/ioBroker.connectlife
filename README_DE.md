<img src="admin/connectlife.svg" width="160" alt="ConnectLife-Cloud-Icon">

# ConnectLife Cloud für ioBroker

[English documentation](README.md)

> [!NOTE]
> Experimenteller, inoffizieller ioBroker-Adapter für die ConnectLife-Cloud. Getestet wurde er mit Hisense-Klimageräten.
> Konten, die ausschließlich über Google, Apple oder Microsoft angelegt wurden, werden derzeit nicht unterstützt. Der Adapter benötigt eine ConnectLife-E-Mail-Adresse und ein ConnectLife-Passwort.

## Voraussetzungen

- Node.js 22 oder 24
- js-controller 6.0.11 oder neuer
- Admin 7.6.20 oder neuer
- ein ConnectLife-Konto mit E-Mail-Adresse und ConnectLife-Passwort

## Funktionen

- ConnectLife-Login über Gigya und OAuth
- OAuth-Refresh-Token zur Reduktion vollständiger Kontoanmeldungen
- Behandlung von Login-Ratenlimits mit exponentiellem Backoff und sichtbarer Uhrzeit des nächsten Versuchs
- automatische Erkennung der im Konto vorhandenen Geräte
- regelmäßiger Abruf von `statusList`
- automatische Anlage von Rohdatenpunkten
- Klimaanlagen-Steuerung für Ein/Aus, Solltemperatur, Betriebsart, Lüfterstufe, Silent, Turbo, Eco sowie horizontale und vertikale Luftführung
- optionales Schreiben unbekannter Roh-Properties
- Verbindungs- und Fehlerstatus unter `info`
- automatische einmalige Wiederholung bei einem ConnectLife-Fehler `randStr check fail`
- stabilere Verbindungsanzeige bei einzelnen vorübergehenden Cloud-Fehlern

## Installation über ioBroker

Im ioBroker-Admin den Expertenmodus aktivieren und **Adapter aus eigener URL installieren** wählen.

GitHub-Adresse:

```text
https://github.com/Andiweli/ioBroker.connectlife
```

Danach die Instanz öffnen und die ConnectLife-E-Mail-Adresse sowie das Passwort eintragen.

## Login-Ratenlimits

ConnectLife kann vollständige Kontoanmeldungen vorübergehend ablehnen, wenn in kurzer Zeit zu viele Loginversuche stattfinden. Während dieser Zeit bleibt die Instanz gelb, `info.connection` steht auf `false`, und der Adapter schreibt den Grund sowie die Uhrzeit des nächsten Versuchs nach `info.lastError` und `info.nextRetry`.

Den Adapter in diesem Zustand weiterlaufen lassen, damit der exponentielle Backoff die Wiederholungen kontrolliert. Ein Neustart erzeugt eine neue Client-Sitzung und erzwingt einen weiteren vollständigen Loginversuch; während eines aktiven serverseitigen Limits sollte das normalerweise vermieden werden. Nach einem erfolgreichen Login wird `info.connection` auf `true` gesetzt und beide Retry-Datenpunkte werden geleert.

## Schreiben auf Rohdatenpunkte

Unter `devices.<Gerät>.raw` legt der Adapter die von ConnectLife gelieferten Original-Eigenschaften ab.

Ist **Schreiben auf unbekannte Rohdatenpunkte erlauben** aktiviert, können solche Original-Eigenschaften direkt an die ConnectLife-Cloud gesendet werden. Das ist hauptsächlich zum Testen noch nicht komfortabel abgebildeter Funktionen gedacht. Nicht jeder Rohdatenpunkt ist tatsächlich beschreibbar; ungültige Werte können von der Cloud oder vom Gerät abgelehnt werden.

Für den normalen Betrieb sollte diese Option ausgeschaltet bleiben.

## Erwartete Objektstruktur

```text
connectlife.0
├── info
│   ├── connection
│   ├── lastUpdate
│   ├── lastError
│   └── nextRetry
└── devices
    └── DEVICE
        ├── info
        ├── status
        ├── controls
        └── raw
```

## Wichtiger Hinweis

Die verwendete ConnectLife-Schnittstelle ist nicht offiziell dokumentiert. Sie wurde aus der ConnectLife-App rekonstruiert. Endpunkte, Schlüssel, Eigenschaften oder der Login können sich jederzeit ändern.

Dieser Adapter wurde KI-unterstützt entwickelt und ist erhältlich unter https://github.com/Andiweli/ioBroker.connectlife

Basiert auf Teilen von https://github.com/Bilan/connectlife-api-connector

## Noch nicht enthalten

- Energieverbrauch
- Veröffentlichung im offiziellen ioBroker-Adapter-Repository

## Changelog

### 0.3.1 (2026-08-05)

- Alle gemeldeten ESLint-/Prettier-Formatierungsfehler behoben, damit Paket- und Integrationstests ausgeführt werden können.
- Prüf- und Deploy-Jobs auf Node.js 24 ausgerichtet; Node.js 22 bleibt als Laufzeit und Testversion unterstützt.
- Erforderliche Repository-Metadaten in `io-package.json` vervollständigt.
- Laufzeitvoraussetzungen und das Verhalten bei ConnectLife-Login-Ratenlimits dokumentiert.

### 0.3.0 (2026-08-05)

- Mindestversion auf Node.js 22 angehoben und ioBroker-/Release-Abhängigkeiten aktualisiert.
- CI in aufeinanderfolgende Prüf-, Adaptertest- und tagbasierte Release-Jobs überführt.
- Ratenlimit-Planung direkt in den Adapter integriert und den temporären Wrapper entfernt.
- Normale Node.js-Timer durch vom Adapter verwaltete Timer ersetzt.
- Responsives JSONConfig und vollständige Admin-Übersetzungen ergänzt.
- Wartungsdateien und Einstellungen für den Repository-Checker ergänzt.

### 0.2.3 (2026-08-04)

- Ratenlimit-Wiederholungen ohne blockierenden Adapterstart geplant.
- `info.nextRetry` ergänzt.

### 0.2.1 (2026-08-04)

- OAuth-Refresh-Token und exponentiellen Login-Backoff ergänzt.

### 0.2.0 (2026-08-04)

- Adapterstruktur, geschützte Zugangsdaten, JSONConfig-i18n und Standardtests modernisiert.

## Lizenz

MIT-Lizenz

Copyright (c) 2026 Andreas Stürmer
