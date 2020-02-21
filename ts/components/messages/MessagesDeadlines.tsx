import {
  compareDesc,
  endOfMonth,
  endOfYesterday,
  startOfDay,
  startOfMonth,
  subMonths
} from "date-fns";
import { index as fpIndex } from "fp-ts/lib/Array";
import { fromNullable, isNone, none, Option, some } from "fp-ts/lib/Option";
import * as pot from "italia-ts-commons/lib/pot";
import { Tuple2 } from "italia-ts-commons/lib/tuples";
import { View } from "native-base";
import React from "react";
import { Platform, SectionListScrollParams, StyleSheet } from "react-native";
import I18n from "../../i18n";
import { lexicallyOrderedMessagesStateSelector } from "../../store/reducers/entities/messages";
import { MessageState } from "../../store/reducers/entities/messages/messagesById";
import { isCreatedMessageWithContentAndDueDate } from "../../types/CreatedMessageWithContentAndDueDate";
import { ComponentProps } from "../../types/react";
import { HEADER_HEIGHT } from "../../utils/constants";
import { DateFromISOString } from "../../utils/dates";
import {
  InjectedWithItemsSelectionProps,
  withItemsSelection
} from "../helpers/withItemsSelection";
import { ListSelectionBar } from "../ListSelectionBar";
import MessageAgenda, {
  isFakeItem,
  MessageAgendaItem,
  MessageAgendaSection,
  Sections
} from "./MessageAgenda";

// How many past months to load in batch
const PAST_DATA_MONTHS = 3;

const SCROLL_RANGE_FOR_ANIMATION = HEADER_HEIGHT;

const styles = StyleSheet.create({
  listWrapper: {
    flex: 1
  },
  animatedStartPosition: {
    bottom: Platform.OS === "ios" ? SCROLL_RANGE_FOR_ANIMATION : 0
  },
  listContainer: {
    flex: 1
  }
});

type OwnProps = {
  currentTab: number;
  messagesState: ReturnType<typeof lexicallyOrderedMessagesStateSelector>;
  navigateToMessageDetail: (id: string) => void;
  setMessagesArchivedState: (
    ids: ReadonlyArray<string>,
    archived: boolean
  ) => void;
};

type Props = Pick<
  ComponentProps<typeof MessageAgenda>,
  "servicesById" | "paymentsByRptId"
> &
  OwnProps &
  InjectedWithItemsSelectionProps;

type State = {
  isWorking: boolean;
  sections: Sections;
  // Here we save the sections to render.
  // We only want to render sections starting from a specific time limit.
  sectionsToRender: Sections;
  maybeLastLoadedStartOfMonthTime: Option<number>;
  lastMessagesState?: pot.Pot<ReadonlyArray<MessageState>, string>;
  allMessageIdsState: Set<string>;
  isContinuosScrollEnabled: boolean;
  lastDeadlineId: Option<string>;
  nextDeadlineId: Option<string>;
};

/**
 * Get the last deadline id (the oldest in time is the first in array position)
 */
export const getLastDeadlineId = (sections: Sections): Option<string> => {
  return fromNullable(sections)
    .chain(s => fpIndex(0, s))
    .chain(d => fpIndex(0, [...d.data]))
    .fold(none, item => {
      if (!isFakeItem(item)) {
        return some(item.e1.id);
      }
      return none;
    });
};

/**
 * Get the next deadline id
 */
export const getNextDeadlineId = (sections: Sections): Option<string> => {
  const now = startOfDay(new Date()).getTime();
  return sections
    .reduce<Option<MessageAgendaItem>>((acc, curr) => {
      const item = curr.data[0];
      // if item is fake, return the accumulator
      if (isFakeItem(item)) {
        return acc;
      }
      const newDate = new Date(item.e1.content.due_date).getTime();
      const diff = newDate - now;
      // if the acc is none, we don't need to make comparison with previous value
      if (isNone(acc)) {
        // just check the newDate is about future
        return diff >= 0 ? some(item) : none;
      }
      const lastDate = acc.value.e1.content.due_date.getTime();
      // if the new date is about future and is less than in accomulator
      if (newDate >= now && lastDate > newDate) {
        return some(item);
      }
      return acc;
    }, none)
    .map(item => item.e1.id);
};

/**
 * Filter only the messages with a due date and group them by due_date day.
 */
const generateSections = (
  potMessagesState: pot.Pot<ReadonlyArray<MessageState>, string>
): Sections =>
  pot.getOrElse(
    pot.map(
      potMessagesState,
      _ =>
        // tslint:disable-next-line:readonly-array
        _.reduce<MessageAgendaItem[]>((accumulator, messageState) => {
          const { isRead, isArchived, message } = messageState;
          if (
            !isArchived &&
            pot.isSome(message) &&
            isCreatedMessageWithContentAndDueDate(message.value)
          ) {
            accumulator.push(
              Tuple2(message.value, {
                isRead
              })
            );
          }

          return accumulator;
        }, [])
          // Sort by due_date
          .sort((messageAgendaItem1, messageAgendaItem2) =>
            compareDesc(
              messageAgendaItem1.e1.content.due_date,
              messageAgendaItem2.e1.content.due_date
            )
          )
          // Now we have an array of messages sorted by due_date.
          // To create groups (by due_date day) we can just iterate the array and
          // -  if the current message due_date day is different from the one of
          //    the prevMessage create a new section
          // -  if the current message due_date day is equal to the one of prevMessage
          //    add the message to the last section
          .reduce<{
            lastTitle: Option<string>;
            // tslint:disable-next-line:readonly-array
            sections: MessageAgendaSection[];
          }>(
            (accumulator, messageAgendaItem) => {
              // As title of the section we use the ISOString rapresentation
              // of the due_date day.
              const title = startOfDay(
                messageAgendaItem.e1.content.due_date
              ).toISOString();
              if (
                accumulator.lastTitle.isNone() ||
                title !== accumulator.lastTitle.value
              ) {
                // We need to create a new section
                const newSection = {
                  title,
                  data: [messageAgendaItem]
                };
                return {
                  lastTitle: some(title),
                  sections: [...accumulator.sections, newSection]
                };
              } else {
                // We need to add the message to the last section.
                // We are sure that pop will return at least one element because
                // of the previous `if` step.
                const prevSection = accumulator.sections.pop() as MessageAgendaSection;
                const newSection = {
                  title,
                  data: [...prevSection.data, messageAgendaItem]
                };
                return {
                  lastTitle: some(title),
                  // We used pop so we need to re-add the section.
                  sections: [...accumulator.sections, newSection]
                };
              }
            },
            {
              lastTitle: none,
              sections: []
            }
          ).sections
    ),
    []
  );

/**
 * Return all the section with a date between the from and to time limit.
 */
const filterSectionsWithTimeLimit = (
  sections: Sections,
  fromTimeLimit: number,
  toTimeLimit: number
): Sections => {
  const filteredSections: Sections = [];

  for (const section of sections) {
    const decodedValue = DateFromISOString.decode(section.title);
    const sectionTime = decodedValue.isRight()
      ? decodedValue.value.getTime()
      : section.title;
    if (sectionTime > toTimeLimit) {
      break;
    }

    if (sectionTime >= fromTimeLimit && sectionTime <= toTimeLimit) {
      filteredSections.push(section);
    }
  }

  return filteredSections;
};

const selectCurrentMonthRemainingData = (sections: Sections): Sections => {
  const startOfCurrentMonthTime = startOfMonth(new Date()).getTime();
  const endOfYesterdayTime = endOfYesterday().getTime();

  return filterSectionsWithTimeLimit(
    sections,
    startOfCurrentMonthTime,
    endOfYesterdayTime
  );
};

const selectPastMonthsData = (
  sections: Sections,
  howManyMonthsBack: number,
  initialStartOfMonthTime: number = startOfMonth(new Date()).getTime()
): Sections => {
  const newSections: Sections = [];

  new Array(howManyMonthsBack).fill(0).forEach((_, index) => {
    const selectedMonth = subMonths(
      initialStartOfMonthTime,
      howManyMonthsBack - index
    );

    const startOfSelectedMonthTime = startOfMonth(selectedMonth).getTime();
    const endOfSelectedMonthTime = endOfMonth(selectedMonth).getTime();

    const monthSections = filterSectionsWithTimeLimit(
      sections,
      startOfSelectedMonthTime,
      endOfSelectedMonthTime
    );

    // If we have no sections for this month create an ad-hoc empty section
    if (monthSections.length === 0) {
      const emptySection: MessageAgendaSection = {
        title: startOfSelectedMonthTime,
        fake: true,
        data: [{ fake: true }]
      };
      monthSections.push(emptySection);
    }

    newSections.push(...monthSections);
  });

  return newSections;
};

// return true if the last section is loaded
const isLastSectionLoaded = (
  lastDeadlineId: Option<string>,
  sections: Sections
): boolean =>
  lastDeadlineId.fold(false, lastId =>
    sections
      .map(s => s.data)
      .some(items =>
        items.some(item => !isFakeItem(item) && item.e1.id === lastId)
      )
  );

const selectMoreSectionsToRenderAsync = async (
  sections: Sections,
  maybeLastLoadedStartOfMonthTime: Option<number>
): Promise<Sections> => {
  return new Promise(resolve => {
    const moreSectionsToRender: Sections = [];

    moreSectionsToRender.push(
      ...selectPastMonthsData(
        sections,
        PAST_DATA_MONTHS,
        maybeLastLoadedStartOfMonthTime.toUndefined()
      )
    );

    if (maybeLastLoadedStartOfMonthTime.isNone()) {
      moreSectionsToRender.push(...selectCurrentMonthRemainingData(sections));
    }

    resolve(moreSectionsToRender);
  });
};

/**
 * A component to show the messages with a due_date.
 */
class MessagesDeadlines extends React.PureComponent<Props, State> {
  private messageAgendaRef = React.createRef<MessageAgenda>();

  private handleOnPressItem = (id: string) => {
    if (this.props.selectedItemIds.isSome()) {
      // Is the selection mode is active a simple "press" must act as
      // a "longPress" (select the item).
      this.handleOnLongPressItem(id);
    } else {
      this.props.navigateToMessageDetail(id);
    }
  };

  private handleOnLongPressItem = (id: string) => {
    this.props.toggleItemSelection(id);
  };

  private toggleAllMessagesSelection = () => {
    const { allMessageIdsState } = this.state;
    const { selectedItemIds } = this.props;
    if (selectedItemIds.isSome()) {
      this.props.setSelectedItemIds(
        some(
          allMessageIdsState.size === selectedItemIds.value.size
            ? new Set()
            : allMessageIdsState
        )
      );
    }
  };

  private archiveMessages = () => {
    this.props.resetSelection();
    this.props.setMessagesArchivedState(
      this.props.selectedItemIds.map(_ => Array.from(_)).getOrElse([]),
      true
    );
  };

  private onLoadMoreDataRequest = () => {
    const { sections, maybeLastLoadedStartOfMonthTime } = this.state;

    this.setState({
      isWorking: true
    });
    selectMoreSectionsToRenderAsync(sections, maybeLastLoadedStartOfMonthTime)
      .then(moreSectionsToRender => {
        this.setState((prevState: State) => {
          const lastLoadedStartOfMonthTime = maybeLastLoadedStartOfMonthTime.getOrElse(
            startOfMonth(new Date()).getTime()
          );

          return {
            isWorking: false,
            sectionsToRender: [
              ...moreSectionsToRender,
              ...prevState.sectionsToRender
            ],
            allMessageIdsState: new Set([
              ...this.generateMessagesIdsFromMessageAgendaSection(
                moreSectionsToRender
              ),
              ...prevState.allMessageIdsState
            ]),
            maybeLastLoadedStartOfMonthTime: some(
              startOfMonth(
                subMonths(lastLoadedStartOfMonthTime, PAST_DATA_MONTHS)
              ).getTime()
            ),
            isContinuosScrollEnabled: !isLastSectionLoaded(
              this.state.lastDeadlineId,
              [...moreSectionsToRender, ...prevState.sectionsToRender]
            )
          };
        });
      })
      .catch(() => 0);
  };

  constructor(props: Props) {
    super(props);
    this.state = {
      isWorking: true,
      sections: [],
      sectionsToRender: [],
      maybeLastLoadedStartOfMonthTime: none,
      allMessageIdsState: new Set(),
      isContinuosScrollEnabled: true,
      lastDeadlineId: none,
      nextDeadlineId: none
    };
  }

  public async componentDidMount() {
    const { messagesState } = this.props;

    const sections = await Promise.resolve(generateSections(messagesState));
    const lastDeadlineId = await Promise.resolve(getLastDeadlineId(sections));
    const nextDeadlineId = await Promise.resolve(getNextDeadlineId(sections));

    // If there are older deadlines the scroll must be enabled to allow data loading when requested
    const isContinuosScrollEnabled = await Promise.resolve(
      !isLastSectionLoaded(lastDeadlineId, sections)
    );

    this.setState({
      isWorking: false,
      sections,
      allMessageIdsState: this.generateMessagesIdsFromMessageAgendaSection(
        sections
      ),
      isContinuosScrollEnabled,
      lastDeadlineId,
      nextDeadlineId
    });
  }

  public async componentDidUpdate(prevProps: Props) {
    const { messagesState } = this.props;
    const { messagesState: prevMessagesState } = prevProps;

    if (prevProps.currentTab !== this.props.currentTab) {
      this.props.resetSelection();
    }

    if (messagesState !== prevMessagesState) {
      this.setState({
        isWorking: true
      });

      const sections = await Promise.resolve(generateSections(messagesState));
      const lastDeadlineId = await Promise.resolve(getLastDeadlineId(sections));
      const nextDeadlineId = await Promise.resolve(getNextDeadlineId(sections));
      // If there are older deadlines the scroll must be enabled to allow data loading when requested
      const isContinuosScrollEnabled = await Promise.resolve(
        !isLastSectionLoaded(lastDeadlineId, sections)
      );

      this.setState({
        isWorking: false,
        sections,
        allMessageIdsState: this.generateMessagesIdsFromMessageAgendaSection(
          sections
        ),
        isContinuosScrollEnabled,
        lastDeadlineId,
        nextDeadlineId
      });
    }
  }

  private generateMessagesIdsFromMessageAgendaSection(
    sections: Sections
  ): Set<string> {
    // tslint:disable-next-line: readonly-array
    const messagesIds: string[] = [];
    sections.forEach(messageAgendaSection =>
      messageAgendaSection.data.forEach(item => {
        const idMessage = !isFakeItem(item) ? item.e1.id : undefined;
        if (idMessage !== undefined) {
          messagesIds.push(idMessage);
        }
      })
    );
    return messagesIds.length > 0 ? new Set(messagesIds) : new Set();
  }

  public render() {
    const {
      messagesState,
      servicesById,
      paymentsByRptId,
      selectedItemIds,
      resetSelection
    } = this.props;
    const {
      sections,
      allMessageIdsState,
      isWorking,
      isContinuosScrollEnabled,
      lastDeadlineId,
      nextDeadlineId
    } = this.state;

    const isRefreshing = pot.isLoading(messagesState) || isWorking;

    return (
      <View style={styles.listWrapper}>
        <View style={styles.listContainer}>
          <MessageAgenda
            ref={this.messageAgendaRef}
            sections={sections}
            servicesById={servicesById}
            paymentsByRptId={paymentsByRptId}
            refreshing={isRefreshing}
            selectedMessageIds={selectedItemIds}
            onPressItem={this.handleOnPressItem}
            onLongPressItem={this.handleOnLongPressItem}
            onMoreDataRequest={this.onLoadMoreDataRequest}
            isContinuosScrollEnabled={isContinuosScrollEnabled}
            lastDeadlineId={lastDeadlineId}
            nextDeadlineId={nextDeadlineId}
          />
        </View>
        <ListSelectionBar
          selectedItemIds={selectedItemIds}
          allItemIds={some(allMessageIdsState)}
          onToggleSelection={this.archiveMessages}
          onToggleAllSelection={this.toggleAllMessagesSelection}
          onResetSelection={resetSelection}
          primaryButtonText={I18n.t("messages.cta.archive")}
        />
      </View>
    );
  }
}

export default withItemsSelection(MessagesDeadlines);
