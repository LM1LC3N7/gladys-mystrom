// -----------------------------------------------------------------------------
// The texts shown to the user (connection status, button answers), in English
// and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });

export const KIND_LABELS = {
  switch: both('Switch', 'Prise'),
  bulb: both('Bulb', 'Ampoule'),
  strip: both('LED strip', 'Bande LED'),
  button: both('Button', 'Bouton'),
  pir: both('Motion sensor', 'Détecteur de mouvement'),
};

export const T = {
  sameAddress: (address, previous, next) =>
    both(
      `Two devices at ${address}: ${previous} was known there, ${next} answers now. Give each device a fixed address in your router.`,
      `Deux appareils à l'adresse ${address} : ${previous} y était connu, ${next} y répond maintenant. Donnez une adresse fixe à chaque appareil dans votre box.`,
    ),
  lost: (macs) =>
    both(
      `No longer at their address, searched again: ${macs.join(', ')}.`,
      `Plus à leur adresse, recherchés à nouveau : ${macs.join(', ')}.`,
    ),
  noDevice: both(
    'No myStrom device yet: type their IP addresses in the configuration, or use "Find the myStrom devices".',
    'Aucun appareil myStrom pour le moment : saisissez leurs adresses IP dans la configuration, ou utilisez « Chercher les appareils myStrom ».',
  ),
  status: (answering, polled, buttons) =>
    both(
      `${answering} of ${polled} myStrom device(s) answer` +
        (buttons > 0 ? `, ${buttons} button(s) known.` : '.'),
      `${answering} appareil(s) myStrom sur ${polled} répond(ent)` +
        (buttons > 0 ? `, ${buttons} bouton(s) connu(s).` : '.'),
    ),
  onlyButtons: (buttons) =>
    both(
      `${buttons} myStrom button(s) known (they sleep between presses).`,
      `${buttons} bouton(s) myStrom connu(s) (ils dorment entre deux appuis).`,
    ),
  invalidAddresses: (list) =>
    both(
      `Ignored, not an address: ${list.join(', ')}.`,
      `Ignoré, ce n'est pas une adresse : ${list.join(', ')}.`,
    ),
  tokenRefused: (list) =>
    both(
      `Token refused by ${list.join(', ')}: check the API token.`,
      `Jeton refusé par ${list.join(', ')} : vérifiez le jeton d'API.`,
    ),
  notMyStrom: (list) =>
    both(
      `Not a supported myStrom device: ${list.join(', ')}.`,
      `Pas un appareil myStrom pris en charge : ${list.join(', ')}.`,
    ),
  find: {
    failed: (reason) =>
      both(
        `The search failed (${reason}). Type the IP addresses of the devices in the configuration instead.`,
        `La recherche a échoué (${reason}). Saisissez plutôt les adresses IP des appareils dans la configuration.`,
      ),
    none: both(
      'No myStrom device announced itself within 7 seconds. Buttons only do it while awake (plugged on USB). Type the IP addresses in the configuration instead.',
      "Aucun appareil myStrom ne s'est annoncé en 7 secondes. Les boutons ne le font qu'éveillés (branchés en USB). Saisissez plutôt les adresses IP dans la configuration.",
    ),
    found: (list) =>
      both(
        `Found, in the Discovery tab:\n${list.map((d) => d.en).join('\n')}`,
        `Trouvé(s), dans l'onglet Découverte :\n${list.map((d) => d.fr).join('\n')}`,
      ),
  },
  setup: {
    badGladysAddress: both(
      'The "Address of Gladys for the buttons" is not a valid IP address (no port, no URL): correct it and save.',
      "L'« Adresse de Gladys pour les boutons » n'est pas une adresse IP valide (sans port ni URL) : corrigez-la et enregistrez.",
    ),
    noGladysAddress: both(
      'Type first the IP address of the Gladys machine in "Address of Gladys for the buttons", and save.',
      "Saisissez d'abord l'adresse IP de la machine Gladys dans « Adresse de Gladys pour les boutons », puis enregistrez.",
    ),
    noButton: both(
      'No myStrom button known yet. Plug the button on USB (it stays awake), then use "Find the myStrom devices" or type its IP address in the configuration.',
      'Aucun bouton myStrom connu. Branchez le bouton en USB (il reste éveillé), puis utilisez « Chercher les appareils myStrom » ou saisissez son adresse IP dans la configuration.',
    ),
    noPort: (reason) =>
      both(
        `The button receiver is not running yet (${reason}). Try again in a minute.`,
        `Le récepteur des boutons n'est pas encore démarré (${reason}). Réessayez dans une minute.`,
      ),
    result: (done, failed) =>
      both(
        [
          done.length > 0 ? `Action URLs set on: ${done.join(', ')}.` : '',
          failed.length > 0
            ? `Not reached: ${failed.join(', ')}. A button only listens while awake: plug it on USB and try again.`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        [
          done.length > 0 ? `URL d'action enregistrées sur : ${done.join(', ')}.` : '',
          failed.length > 0
            ? `Non joint(s) : ${failed.join(', ')}. Un bouton n'écoute qu'éveillé : branchez-le en USB et réessayez.`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
  },
};
