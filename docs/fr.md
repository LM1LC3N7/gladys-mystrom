# myStrom

Vos appareils Wi-Fi myStrom dans Gladys, sur votre réseau local, par l'API
REST que les appareils servent eux-mêmes : pas de cloud myStrom, pas de compte.
Intégration non officielle, sans lien avec myStrom AG.

## Ce que vous obtenez

| Appareil                                    | Dans Gladys                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Prise Switch (CH v1, CH v2, EU, Zero)       | Marche/arrêt, puissance (W), index d'énergie (kWh), température (°C), selon ce que le modèle mesure           |
| Ampoule (Bulb)                              | Marche/arrêt, luminosité, couleur, température du blanc, puissance                                            |
| Bande LED (LED Strip)                       | Marche/arrêt, luminosité, couleur, puissance                                                                  |
| Button, Button Plus (1re et 2e génération)  | Une fonctionnalité bouton, et le déclencheur de scène **Bouton myStrom** (simple, double, long, effleurement) |
| Détecteur de mouvement (Motion Sensor, PIR) | Mouvement, luminosité ambiante (lux), température                                                             |

Les prises, lampes et détecteurs sont lus toutes les 10 secondes (le réglage
**Intervalle de rafraîchissement**, de 5 secondes à 5 minutes) : un mouvement
est vu au plus avec ce retard. L'index d'énergie continue de croître quand une
prise redémarre.

## Mise en place

1. Dans votre box, donnez une adresse IP fixe à chaque appareil myStrom (une
   réservation DHCP) : l'intégration les joint par leur adresse.
2. Dans Gladys, ouvrez l'onglet **Configuration** de l'intégration et
   saisissez les adresses dans **Adresses IP des appareils**, séparées par des
   virgules, par exemple `192.168.1.30, 192.168.1.31`. Ou utilisez **Chercher
   les appareils myStrom** : les appareils s'annoncent sur le réseau toutes les
   quelques secondes, et Gladys écoute pendant 7 secondes.
3. Enregistrez. Les appareils apparaissent dans l'onglet **Découverte** :
   ajoutez ceux que vous voulez.

Si vous avez protégé l'API locale de vos appareils par un jeton dans
l'application myStrom, saisissez-le dans **Jeton d'API**. Un seul jeton pour
tous les appareils : des appareils protégés par des jetons différents ne sont
pas encore pris en charge. Un appareil trouvé par la recherche est d'abord
interrogé sans le jeton : le jeton n'est envoyé qu'à un appareil qui le
demande.

L'intégration vérifie régulièrement que l'appareil qui répond à une adresse
est toujours le même (son adresse MAC). Si votre box donne l'adresse d'un
appareil à un autre, le premier est affiché injoignable et recherché à
nouveau, et l'état de l'intégration nomme les deux : donnez des adresses fixes
à vos appareils.

## Boutons

Un bouton myStrom dort entre deux appuis : Gladys ne peut rien lui demander.
Quand on l'appuie, il appelle l'adresse qu'on lui a donnée (son « URL
d'action »). L'intégration fait tourner un petit récepteur pour ces appels,
dans un second conteneur que Gladys démarre et publie sur un port de la
machine Gladys (affiché dans l'écran de configuration).

1. Saisissez l'adresse IP de la machine Gladys sur votre réseau dans
   **Adresse de Gladys pour les boutons** (par exemple `192.168.1.10`), et
   enregistrez.
2. Branchez chaque bouton en USB : il reste éveillé pendant la charge.
   Faites-le connaître à Gladys (son adresse dans la liste, ou **Chercher les
   appareils myStrom**).
3. Utilisez **Enregistrer les URL d'action des boutons**. Les appuis simple,
   double et long (et l'effleurement d'un Button Plus) de chaque bouton
   éveillé appellent désormais Gladys. Cela remplace ce que l'application
   myStrom avait réglé sur ces appuis.
4. Dans une scène, utilisez le déclencheur **Bouton myStrom**, choisissez le
   bouton et l'appui. L'appui est dans la variable `press` du déclencheur.

Un bouton non joint (endormi) est nommé dans la réponse : branchez-le en USB
et relancez l'enregistrement.

Les URL d'action contiennent un secret aléatoire : une autre machine de votre
réseau ne peut pas lancer vos scènes en les devinant. La protection est
limitée : les boutons appellent Gladys en HTTP simple, donc le secret est
visible par qui écoute votre réseau, et relisible sur un bouton par qui joint
son API locale. Il ne fait que lancer des scènes, il ne donne aucun accès à
Gladys. Si vous pensez qu'il a fuité, voyez « Dépannage ».

## Bon à savoir

- Tout reste sur votre réseau : Gladys parle aux appareils en HTTP simple,
  comme le fait l'API myStrom. Gardez votre Wi-Fi fermé aux inconnus.
- La molette du Button Plus, les effets de l'ampoule (lever de soleil,
  arc-en-ciel) et les réglages du détecteur ne sont pas gérés.
- Les appareils joints par Gladys affichent un badge « local », « injoignable »
  quand ils ne répondent plus.

## Dépannage

- **« Jeton refusé »** : l'appareil a un jeton dans l'application myStrom ;
  saisissez-le dans **Jeton d'API**.
- **La recherche ne trouve rien** : certains réseaux ne laissent pas Gladys
  entendre les annonces, et les boutons ne s'annoncent qu'éveillés. Saisissez
  plutôt les adresses.
- **Le secret des boutons a fuité** : le renouveler n'est pas encore possible
  depuis l'écran de configuration (prévu). En attendant, retirez les URL
  d'action du bouton dans l'application myStrom.
- **Un appui ne fait rien** : vérifiez que l'adresse de Gladys est bien celle
  que les boutons joignent (pas une adresse VPN ni Gladys Plus), et
  réenregistrez les URL d'action après l'avoir changée.
