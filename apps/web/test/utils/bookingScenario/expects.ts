import prismaMock from "../../../../../tests/libs/__mocks__/prisma";

import type { WebhookTriggerEvents, Booking, BookingReference, DestinationCalendar } from "@prisma/client";
import { parse } from "node-html-parser";
import type { VEvent } from "node-ical";
import ical from "node-ical";
import { expect } from "vitest";
import "vitest-fetch-mock";

import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { BookingStatus } from "@calcom/prisma/enums";
import type { AppsStatus } from "@calcom/types/Calendar";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { Fixtures } from "@calcom/web/test/fixtures/fixtures";

import type { InputEventType } from "./bookingScenario";

type Recurrence = {
  freq: number;
  interval: number;
  count: number;
};
type ExpectedEmail = {
  /**
   * Checks the main heading of the email - Also referred to as title in code at some places
   */
  heading?: string;
  /**
   * Checks the sub heading of the email - Also referred to as subTitle in code
   */
  subHeading?: string;
  /**
   * Checks the <title> tag - Not sure what's the use of it, as it is not shown in UI it seems.
   */
  titleTag?: string;
  to: string;
  // TODO: Implement these and more
  // what?: string;
  // when?: string;
  // who?: string;
  // where?: string;
  // additionalNotes?: string;
  // footer?: {
  //   rescheduleLink?: string;
  //   cancelLink?: string;
  // };
  ics?: {
    filename: string;
    iCalUID: string;
    recurrence?: Recurrence;
  };
  /**
   * Checks that there is no
   */
  noIcs?: true;
  appsStatus?: AppsStatus[];
};
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toHaveEmail(expectedEmail: ExpectedEmail, to: string): R;
    }
  }
}

expect.extend({
  toHaveEmail(emails: Fixtures["emails"], expectedEmail: ExpectedEmail, to: string) {
    const { isNot } = this;
    const testEmail = emails.get().find((email) => email.to.includes(to));
    const emailsToLog = emails
      .get()
      .map((email) => ({ to: email.to, html: email.html, ics: email.icalEvent }));

    if (!testEmail) {
      logger.silly("All Emails", JSON.stringify({ numEmails: emailsToLog.length, emailsToLog }));
      return {
        pass: false,
        message: () => `No email sent to ${to}`,
      };
    }
    const ics = testEmail.icalEvent;
    const icsObject = ics?.content ? ical.sync.parseICS(ics?.content) : null;
    const iCalUidData = icsObject ? icsObject[expectedEmail.ics?.iCalUID || ""] : null;

    let isToAddressExpected = true;
    const isIcsFilenameExpected = expectedEmail.ics ? ics?.filename === expectedEmail.ics.filename : true;
    const isIcsUIDExpected = expectedEmail.ics
      ? !!(icsObject ? icsObject[expectedEmail.ics.iCalUID] : null)
      : true;
    const emailDom = parse(testEmail.html);

    const actualEmailContent = {
      titleTag: emailDom.querySelector("title")?.innerText,
      heading: emailDom.querySelector('[data-testid="heading"]')?.innerText,
      subHeading: emailDom.querySelector('[data-testid="subHeading"]')?.innerText,
    };

    const expectedEmailContent = getExpectedEmailContent(expectedEmail);
    assertHasRecurrence(expectedEmail.ics?.recurrence, (iCalUidData as VEvent)?.rrule?.toString() || "");

    const isEmailContentMatched = this.equals(
      actualEmailContent,
      expect.objectContaining(expectedEmailContent)
    );

    if (!isEmailContentMatched) {
      logger.silly("All Emails", JSON.stringify({ numEmails: emailsToLog.length, emailsToLog }));

      return {
        pass: false,
        message: () => `Email content ${isNot ? "is" : "is not"} matching`,
        actual: actualEmailContent,
        expected: expectedEmailContent,
      };
    }

    isToAddressExpected = expectedEmail.to === testEmail.to;
    if (!isToAddressExpected) {
      logger.silly("All Emails", JSON.stringify({ numEmails: emailsToLog.length, emailsToLog }));
      return {
        pass: false,
        message: () => `To address ${isNot ? "is" : "is not"} matching`,
        actual: testEmail.to,
        expected: expectedEmail.to,
      };
    }

    if (!expectedEmail.noIcs && !isIcsFilenameExpected) {
      return {
        pass: false,
        actual: ics?.filename,
        expected: expectedEmail.ics?.filename,
        message: () => `ICS Filename ${isNot ? "is" : "is not"} matching`,
      };
    }

    if (!expectedEmail.noIcs && !isIcsUIDExpected) {
      return {
        pass: false,
        actual: JSON.stringify(icsObject),
        expected: expectedEmail.ics?.iCalUID,
        message: () => `Expected ICS UID ${isNot ? "is" : "isn't"} present in actual`,
      };
    }

    if (expectedEmail.noIcs && ics) {
      return {
        pass: false,
        message: () => `${isNot ? "" : "Not"} expected ics file`,
      };
    }

    if (expectedEmail.appsStatus) {
      const actualAppsStatus = emailDom.querySelectorAll('[data-testid="appsStatus"] li').map((li) => {
        return li.innerText.trim();
      });
      const expectedAppStatus = expectedEmail.appsStatus.map((appStatus) => {
        if (appStatus.success && !appStatus.failures) {
          return `${appStatus.appName} ✅`;
        }
        return `${appStatus.appName} ❌`;
      });

      const isAppsStatusCorrect = this.equals(actualAppsStatus, expectedAppStatus);

      if (!isAppsStatusCorrect) {
        return {
          pass: false,
          actual: actualAppsStatus,
          expected: expectedAppStatus,
          message: () => `AppsStatus ${isNot ? "is" : "isn't"} matching`,
        };
      }
    }

    return {
      pass: true,
      message: () => `Email ${isNot ? "is" : "isn't"} correct`,
    };

    function getExpectedEmailContent(expectedEmail: ExpectedEmail) {
      const expectedEmailContent = {
        titleTag: expectedEmail.titleTag,
        heading: expectedEmail.heading,
        subHeading: expectedEmail.subHeading,
      };
      // Remove undefined props so that they aren't matched, they are intentionally left undefined because we don't want to match them
      Object.keys(expectedEmailContent).filter((key) => {
        if (expectedEmailContent[key as keyof typeof expectedEmailContent] === undefined) {
          delete expectedEmailContent[key as keyof typeof expectedEmailContent];
        }
      });
      return expectedEmailContent;
    }

    function assertHasRecurrence(expectedRecurrence: Recurrence | null | undefined, rrule: string) {
      if (!expectedRecurrence) {
        return;
      }

      const expectedRrule = `FREQ=${
        expectedRecurrence.freq === 0 ? "YEARLY" : expectedRecurrence.freq === 1 ? "MONTHLY" : "WEEKLY"
      };COUNT=${expectedRecurrence.count};INTERVAL=${expectedRecurrence.interval}`;

      logger.silly({
        expectedRrule,
        rrule,
      });
      expect(rrule).toContain(expectedRrule);
    }
  },
});

export function expectWebhookToHaveBeenCalledWith(
  subscriberUrl: string,
  data: {
    triggerEvent: WebhookTriggerEvents;
    payload: Record<string, unknown> | null;
  }
) {
  const fetchCalls = fetchMock.mock.calls;
  const webhooksToSubscriberUrl = fetchCalls.filter((call) => {
    return call[0] === subscriberUrl;
  });
  logger.silly("Scanning fetchCalls for webhook", safeStringify(fetchCalls));
  const webhookFetchCall = webhooksToSubscriberUrl.find((call) => {
    const body = call[1]?.body;
    const parsedBody = JSON.parse((body as string) || "{}");
    return parsedBody.triggerEvent === data.triggerEvent;
  });

  if (!webhookFetchCall) {
    throw new Error(
      `Webhook not sent to ${subscriberUrl} for ${data.triggerEvent}. All webhooks: ${JSON.stringify(
        webhooksToSubscriberUrl
      )}`
    );
  }
  expect(webhookFetchCall[0]).toBe(subscriberUrl);
  const body = webhookFetchCall[1]?.body;
  const parsedBody = JSON.parse((body as string) || "{}");

  expect(parsedBody.triggerEvent).toBe(data.triggerEvent);

  if (parsedBody.payload.metadata?.videoCallUrl) {
    parsedBody.payload.metadata.videoCallUrl = parsedBody.payload.metadata.videoCallUrl
      ? parsedBody.payload.metadata.videoCallUrl
      : parsedBody.payload.metadata.videoCallUrl;
  }
  if (data.payload) {
    if (data.payload.metadata !== undefined) {
      expect(parsedBody.payload.metadata).toEqual(expect.objectContaining(data.payload.metadata));
    }
    if (data.payload.responses !== undefined)
      expect(parsedBody.payload.responses).toEqual(expect.objectContaining(data.payload.responses));
    const { responses: _1, metadata: _2, ...remainingPayload } = data.payload;
    expect(parsedBody.payload).toEqual(expect.objectContaining(remainingPayload));
  }
}

export function expectWorkflowToBeTriggered() {
  // TODO: Implement this.
}

export async function expectBookingToBeInDatabase(
  booking: Partial<Booking> & Pick<Booking, "uid"> & { references?: Partial<BookingReference>[] }
) {
  const actualBooking = await prismaMock.booking.findUnique({
    where: {
      uid: booking.uid,
    },
    include: {
      references: true,
    },
  });

  const { references, ...remainingBooking } = booking;
  expect(actualBooking).toEqual(expect.objectContaining(remainingBooking));
  expect(actualBooking?.references).toEqual(
    expect.arrayContaining((references || []).map((reference) => expect.objectContaining(reference)))
  );
}

export function expectSuccessfulBookingCreationEmails({
  emails,
  organizer,
  booker,
  guests,
  otherTeamMembers,
  iCalUID,
  recurrence,
}: {
  emails: Fixtures["emails"];
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
  guests?: { email: string; name: string }[];
  otherTeamMembers?: { email: string; name: string }[];
  iCalUID: string;
  recurrence?: Recurrence;
}) {
  expect(emails).toHaveEmail(
    {
      titleTag: "confirmed_event_type_subject",
      heading: recurrence ? "new_event_scheduled_recurring" : "new_event_scheduled",
      subHeading: "",
      to: `${organizer.email}`,
      ics: {
        filename: "event.ics",
        iCalUID: `${iCalUID}`,
        recurrence,
      },
    },
    `${organizer.email}`
  );

  expect(emails).toHaveEmail(
    {
      titleTag: "confirmed_event_type_subject",
      heading: recurrence ? "your_event_has_been_scheduled_recurring" : "your_event_has_been_scheduled",
      subHeading: "emailed_you_and_any_other_attendees",
      to: `${booker.name} <${booker.email}>`,
      ics: {
        filename: "event.ics",
        iCalUID: iCalUID,
        recurrence,
      },
    },
    `${booker.name} <${booker.email}>`
  );

  if (otherTeamMembers) {
    otherTeamMembers.forEach((otherTeamMember) => {
      expect(emails).toHaveEmail(
        {
          titleTag: "confirmed_event_type_subject",
          heading: recurrence ? "new_event_scheduled_recurring" : "new_event_scheduled",
          subHeading: "",

          // Don't know why but organizer and team members of the eventType don'thave their name here like Booker
          to: `${otherTeamMember.email}`,
          ics: {
            filename: "event.ics",
            iCalUID: iCalUID,
          },
        },
        `${otherTeamMember.email}`
      );
    });
  }

  if (guests) {
    guests.forEach((guest) => {
      expect(emails).toHaveEmail(
        {
          titleTag: "confirmed_event_type_subject",
          heading: recurrence ? "your_event_has_been_scheduled_recurring" : "your_event_has_been_scheduled",
          subHeading: "emailed_you_and_any_other_attendees",
          to: `${guest.email}`,
          ics: {
            filename: "event.ics",
            iCalUID: iCalUID,
          },
        },
        `${guest.name} <${guest.email}`
      );
    });
  }
}

export function expectBrokenIntegrationEmails({
  emails,
  organizer,
}: {
  emails: Fixtures["emails"];
  organizer: { email: string; name: string };
}) {
  // Broken Integration email is only sent to the Organizer
  expect(emails).toHaveEmail(
    {
      titleTag: "broken_integration",
      to: `${organizer.email}`,
      // No ics goes in case of broken integration email it seems
      // ics: {
      //   filename: "event.ics",
      //   iCalUID: iCalUID,
      // },
    },
    `${organizer.email}`
  );

  // expect(emails).toHaveEmail(
  //   {
  //     title: "confirmed_event_type_subject",
  //     to: `${booker.name} <${booker.email}>`,
  //   },
  //   `${booker.name} <${booker.email}>`
  // );
}

export function expectCalendarEventCreationFailureEmails({
  emails,
  organizer,
  booker,
  iCalUID,
}: {
  emails: Fixtures["emails"];
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
  iCalUID: string;
}) {
  expect(emails).toHaveEmail(
    {
      titleTag: "broken_integration",
      to: `${organizer.email}`,
      ics: {
        filename: "event.ics",
        iCalUID,
      },
    },
    `${organizer.email}`
  );

  expect(emails).toHaveEmail(
    {
      titleTag: "calendar_event_creation_failure_subject",
      to: `${booker.name} <${booker.email}>`,
      ics: {
        filename: "event.ics",
        iCalUID,
      },
    },
    `${booker.name} <${booker.email}>`
  );
}

export function expectSuccessfulBookingRescheduledEmails({
  emails,
  organizer,
  booker,
  iCalUID,
  appsStatus,
}: {
  emails: Fixtures["emails"];
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
  iCalUID: string;
  appsStatus?: AppsStatus[];
}) {
  expect(emails).toHaveEmail(
    {
      titleTag: "event_type_has_been_rescheduled_on_time_date",
      to: `${organizer.email}`,
      ics: {
        filename: "event.ics",
        iCalUID,
      },
      appsStatus,
    },
    `${organizer.email}`
  );

  expect(emails).toHaveEmail(
    {
      titleTag: "event_type_has_been_rescheduled_on_time_date",
      to: `${booker.name} <${booker.email}>`,
      ics: {
        filename: "event.ics",
        iCalUID,
      },
    },
    `${booker.name} <${booker.email}>`
  );
}
export function expectAwaitingPaymentEmails({
  emails,
  booker,
}: {
  emails: Fixtures["emails"];
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
}) {
  expect(emails).toHaveEmail(
    {
      titleTag: "awaiting_payment_subject",
      to: `${booker.name} <${booker.email}>`,
      noIcs: true,
    },
    `${booker.email}`
  );
}

export function expectBookingRequestedEmails({
  emails,
  organizer,
  booker,
}: {
  emails: Fixtures["emails"];
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
}) {
  expect(emails).toHaveEmail(
    {
      titleTag: "event_awaiting_approval_subject",
      to: `${organizer.email}`,
      noIcs: true,
    },
    `${organizer.email}`
  );

  expect(emails).toHaveEmail(
    {
      titleTag: "booking_submitted_subject",
      to: `${booker.email}`,
      noIcs: true,
    },
    `${booker.email}`
  );
}

export function expectBookingRequestedWebhookToHaveBeenFired({
  booker,
  location,
  subscriberUrl,
  paidEvent,
  eventType,
}: {
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
  subscriberUrl: string;
  location: string;
  paidEvent?: boolean;
  eventType: InputEventType;
}) {
  // There is an inconsistency in the way we send the data to the webhook for paid events and unpaid events. Fix that and then remove this if statement.
  if (!paidEvent) {
    expectWebhookToHaveBeenCalledWith(subscriberUrl, {
      triggerEvent: "BOOKING_REQUESTED",
      payload: {
        eventTitle: eventType.title,
        eventDescription: eventType.description,
        metadata: {
          // In a Pending Booking Request, we don't send the video call url
        },
        responses: {
          name: { label: "your_name", value: booker.name },
          email: { label: "email_address", value: booker.email },
          location: {
            label: "location",
            value: { optionValue: "", value: location },
          },
        },
      },
    });
  } else {
    expectWebhookToHaveBeenCalledWith(subscriberUrl, {
      triggerEvent: "BOOKING_REQUESTED",
      payload: {
        eventTitle: eventType.title,
        eventDescription: eventType.description,
        metadata: {
          // In a Pending Booking Request, we don't send the video call url
        },
        responses: {
          name: { label: "name", value: booker.name },
          email: { label: "email", value: booker.email },
          location: {
            label: "location",
            value: { optionValue: "", value: location },
          },
        },
      },
    });
  }
}

export function expectBookingCreatedWebhookToHaveBeenFired({
  booker,
  location,
  subscriberUrl,
  paidEvent,
  videoCallUrl,
}: {
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
  subscriberUrl: string;
  location: string;
  paidEvent?: boolean;
  videoCallUrl?: string | null;
}) {
  if (!paidEvent) {
    expectWebhookToHaveBeenCalledWith(subscriberUrl, {
      triggerEvent: "BOOKING_CREATED",
      payload: {
        metadata: {
          ...(videoCallUrl ? { videoCallUrl } : null),
        },
        responses: {
          name: { label: "your_name", value: booker.name },
          email: { label: "email_address", value: booker.email },
          location: {
            label: "location",
            value: { optionValue: "", value: location },
          },
        },
      },
    });
  } else {
    expectWebhookToHaveBeenCalledWith(subscriberUrl, {
      triggerEvent: "BOOKING_CREATED",
      payload: {
        // FIXME: File this bug and link ticket here. This is a bug in the code. metadata must be sent here like other BOOKING_CREATED webhook
        metadata: null,
        responses: {
          name: { label: "name", value: booker.name },
          email: { label: "email", value: booker.email },
          location: {
            label: "location",
            value: { optionValue: "", value: location },
          },
        },
      },
    });
  }
}

export function expectBookingRescheduledWebhookToHaveBeenFired({
  booker,
  location,
  subscriberUrl,
  videoCallUrl,
  payload,
}: {
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
  subscriberUrl: string;
  location: string;
  paidEvent?: boolean;
  videoCallUrl?: string;
  payload?: Record<string, unknown>;
}) {
  expectWebhookToHaveBeenCalledWith(subscriberUrl, {
    triggerEvent: "BOOKING_RESCHEDULED",
    payload: {
      ...payload,
      metadata: {
        ...(videoCallUrl ? { videoCallUrl } : null),
      },
      responses: {
        name: { label: "your_name", value: booker.name },
        email: { label: "email_address", value: booker.email },
        location: {
          label: "location",
          value: { optionValue: "", value: location },
        },
      },
    },
  });
}

export function expectBookingPaymentIntiatedWebhookToHaveBeenFired({
  booker,
  location,
  subscriberUrl,
  paymentId,
}: {
  organizer: { email: string; name: string };
  booker: { email: string; name: string };
  subscriberUrl: string;
  location: string;
  paymentId: number;
}) {
  expectWebhookToHaveBeenCalledWith(subscriberUrl, {
    triggerEvent: "BOOKING_PAYMENT_INITIATED",
    payload: {
      paymentId: paymentId,
      metadata: {
        // In a Pending Booking Request, we don't send the video call url
      },
      responses: {
        name: { label: "your_name", value: booker.name },
        email: { label: "email_address", value: booker.email },
        location: {
          label: "location",
          value: { optionValue: "", value: location },
        },
      },
    },
  });
}

export function expectSuccessfulCalendarEventCreationInCalendar(
  calendarMock: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createEventCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateEventCalls: any[];
  },
  expected:
    | {
        calendarId?: string | null;
        videoCallUrl: string;
        destinationCalendars?: Partial<DestinationCalendar>[];
      }
    | {
        calendarId?: string | null;
        videoCallUrl: string;
        destinationCalendars?: Partial<DestinationCalendar>[];
      }[]
) {
  const expecteds = expected instanceof Array ? expected : [expected];
  expect(calendarMock.createEventCalls.length).toBe(expecteds.length);
  for (const [index, call] of Object.entries(calendarMock.createEventCalls)) {
    const expected = expecteds[index];

    const calEvent = call[0];

    expect(calEvent).toEqual(
      expect.objectContaining({
        destinationCalendar: expected.calendarId
          ? [
              expect.objectContaining({
                externalId: expected.calendarId,
              }),
            ]
          : expected.destinationCalendars
          ? expect.arrayContaining(expected.destinationCalendars.map((cal) => expect.objectContaining(cal)))
          : null,
        videoCallData: expect.objectContaining({
          url: expected.videoCallUrl,
        }),
      })
    );
  }
}

export function expectSuccessfulCalendarEventUpdationInCalendar(
  calendarMock: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createEventCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateEventCalls: any[];
  },
  expected: {
    externalCalendarId: string;
    calEvent: Partial<CalendarEvent>;
    uid: string;
  }
) {
  expect(calendarMock.updateEventCalls.length).toBe(1);
  const call = calendarMock.updateEventCalls[0];
  const uid = call[0];
  const calendarEvent = call[1];
  const externalId = call[2];
  expect(uid).toBe(expected.uid);
  expect(calendarEvent).toEqual(expect.objectContaining(expected.calEvent));
  expect(externalId).toBe(expected.externalCalendarId);
}

export function expectSuccessfulCalendarEventDeletionInCalendar(
  calendarMock: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createEventCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateEventCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deleteEventCalls: any[];
  },
  expected: {
    externalCalendarId: string;
    calEvent: Partial<CalendarEvent>;
    uid: string;
  }
) {
  expect(calendarMock.deleteEventCalls.length).toBe(1);
  const call = calendarMock.deleteEventCalls[0];
  const uid = call[0];
  const calendarEvent = call[1];
  const externalId = call[2];
  expect(uid).toBe(expected.uid);
  expect(calendarEvent).toEqual(expect.objectContaining(expected.calEvent));
  expect(externalId).toBe(expected.externalCalendarId);
}

export function expectSuccessfulVideoMeetingCreation(
  videoMock: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMeetingCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMeetingCalls: any[];
  },
  expected: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    credential: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    calEvent: any;
  }
) {
  expect(videoMock.createMeetingCalls.length).toBe(1);
  const call = videoMock.createMeetingCalls[0];
  const callArgs = call.args;
  const calEvent = callArgs[0];
  const credential = call.credential;

  expect(credential).toEqual(expected.credential);
  expect(calEvent).toEqual(expected.calEvent);
}

export function expectSuccessfulVideoMeetingUpdationInCalendar(
  videoMock: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMeetingCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMeetingCalls: any[];
  },
  expected: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bookingRef: any;
    calEvent: Partial<CalendarEvent>;
  }
) {
  expect(videoMock.updateMeetingCalls.length).toBe(1);
  const call = videoMock.updateMeetingCalls[0];
  const bookingRef = call.args[0];
  const calendarEvent = call.args[1];
  expect(bookingRef).toEqual(expect.objectContaining(expected.bookingRef));
  expect(calendarEvent).toEqual(expect.objectContaining(expected.calEvent));
}

export function expectSuccessfulVideoMeetingDeletionInCalendar(
  videoMock: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMeetingCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMeetingCalls: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deleteMeetingCalls: any[];
  },
  expected: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bookingRef: any;
  }
) {
  expect(videoMock.deleteMeetingCalls.length).toBe(1);
  const call = videoMock.deleteMeetingCalls[0];
  const bookingRefUid = call.args[0];
  expect(bookingRefUid).toEqual(expected.bookingRef.uid);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function expectBookingInDBToBeRescheduledFromTo({ from, to }: { from: any; to: any }) {
  // Expect previous booking to be cancelled
  await expectBookingToBeInDatabase({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    ...from,
    status: BookingStatus.CANCELLED,
  });

  // Expect new booking to be created but status would depend on whether the new booking requires confirmation or not.
  await expectBookingToBeInDatabase({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    ...to,
  });
}
