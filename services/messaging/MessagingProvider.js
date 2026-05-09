/**
 * Messaging provider abstraction (BOO-INFOBIP-INTEGRATE-1A).
 * Concrete implementations: TwilioProvider, InfobipProvider.
 */

export class MessagingProvider {
  /**
   * @param {object} business
   * @param {{ phone?: string, name?: string, language?: string }} customer
   * @param {object} ctx - method-specific payload (see implementations)
   * @returns {Promise<{ ok: boolean, messageSid?: string, error?: string }>}
   */
  async sendBookingConfirmation(_business, _customer, _ctx) {
    throw new Error("sendBookingConfirmation not implemented");
  }

  async sendBookingReminder(_business, _customer, _ctx) {
    throw new Error("sendBookingReminder not implemented");
  }

  async sendCancelNotification(_business, _customer, _ctx) {
    throw new Error("sendCancelNotification not implemented");
  }

  /**
   * Reschedule notice (SMS on Twilio; WhatsApp session message on Infobip when possible).
   * @param {object} business
   * @param {{ phone?: string }} customer
   * @param {{ body: string }} ctx
   */
  async sendBookingReschedule(_business, _customer, _ctx) {
    throw new Error("sendBookingReschedule not implemented");
  }
}
